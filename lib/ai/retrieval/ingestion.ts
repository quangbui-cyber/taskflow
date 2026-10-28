import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isAuthoritativeKnowledgeSource } from "@/lib/ai/knowledge/publications";

export type ExtractedKnowledgeSpan = {
  text: string;
  spanKind: "TEXT" | "TABLE" | "CELL" | "XML";
  pageNumber?: number;
  sheetName?: string;
  cellRange?: string;
  xmlPath?: string;
  textStart?: number;
  textEnd?: number;
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function splitKnowledgeText(text: string, maxLength = 1200) {
  if (!Number.isSafeInteger(maxLength) || maxLength < 32 || maxLength > 4000) throw new Error("Invalid chunk length.");
  const chunks: Array<{ text: string; start: number; end: number }> = [];
  const paragraph = /\S(?:[\s\S]*?\S)?(?=\n\s*\n|$)/g;
  for (const match of text.matchAll(paragraph)) {
    const raw = match[0];
    const offset = match.index;
    for (let start = 0; start < raw.length;) {
      const end = Math.min(start + maxLength, raw.length);
      const piece = raw.slice(start, end);
      const lead = piece.match(/^\s*/)?.[0].length ?? 0;
      const tail = piece.match(/\s*$/)?.[0].length ?? 0;
      const value = piece.slice(lead, piece.length - tail);
      if (value) chunks.push({ text: value, start: offset + start + lead, end: offset + end - tail });
      start = end;
    }
  }
  return chunks;
}

export async function extractKnowledgeSpans(bytes: Uint8Array, mimeType: string): Promise<ExtractedKnowledgeSpan[]> {
  if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024) throw new Error("Invalid source size.");
  if (mimeType === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const document = await getDocumentProxy(Uint8Array.from(bytes));
    try {
      const pages = (await extractText(document)).text;
      return pages.slice(0, 200).map((text, index) => ({ text, spanKind: "TEXT" as const, pageNumber: index + 1 }));
    } finally { await document.cleanup(); }
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const copy = Buffer.from(bytes);
    await workbook.xlsx.load(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer);
    const spans: ExtractedKnowledgeSpan[] = [];
    for (const sheet of workbook.worksheets.slice(0, 20)) {
      sheet.eachRow((row) => row.eachCell((cell) => {
        if (spans.length >= 2000) return;
        const value = cell.text.trim();
        if (value) spans.push({ text: value, spanKind: "CELL", sheetName: sheet.name, cellRange: cell.address });
      }));
    }
    return spans;
  }
  if (["text/plain", "text/markdown", "application/json", "application/xml", "text/xml"].includes(mimeType)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return [{ text, spanKind: mimeType.includes("xml") ? "XML" : "TEXT",
      ...(mimeType.includes("xml") ? { xmlPath: "/" } : { textStart: 0, textEnd: text.length }) }];
  }
  throw new Error("Unsupported knowledge source format.");
}

export async function ingestKnowledgeBytes(input: {
  sourceRevisionId: string; parserVersion: string; bytes: Uint8Array; publicationId?: string;
}) {
  const source = await prisma.aiSourceRevision.findUnique({ where: { id: input.sourceRevisionId },
    select: { sha256: true, mimeType: true } });
  if (!source || createHash("sha256").update(input.bytes).digest("hex") !== source.sha256) {
    throw new Error("Source bytes do not match the immutable revision.");
  }
  const spans = await extractKnowledgeSpans(input.bytes, source.mimeType);
  return ingestKnowledgeRevision({ sourceRevisionId: input.sourceRevisionId,
    parserVersion: input.parserVersion, publicationId: input.publicationId, spans });
}

async function ingestKnowledgeRevision(input: {
  sourceRevisionId: string;
  parserVersion: string;
  spans: readonly ExtractedKnowledgeSpan[];
  publicationId?: string;
}) {
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(input.parserVersion) ||
      input.spans.length < 1 || input.spans.length > 2000) throw new Error("Invalid parser output.");
  return prisma.$transaction(async (tx) => {
    const source = await tx.aiSourceRevision.findUnique({ where: { id: input.sourceRevisionId } });
    if (!source) throw new Error("Unknown source revision.");
    const policy = source.originKind === "SOP" || source.originKind === "POLICY";
    const first = input.spans[0];
    const firstLocator = { pageNumber: first.pageNumber, sheetName: first.sheetName,
      cellRange: first.cellRange, xmlPath: first.xmlPath, textStart: first.textStart, textEnd: first.textEnd };
    const firstHash = digest({ sourceRevisionId: source.id, parserVersion: input.parserVersion,
      spanKind: first.spanKind, locator: firstLocator, text: first.text });
    const existing = policy ? [] : await tx.aiKnowledgePublication.findMany({
      where: { sourceRevisionId: source.id }, orderBy: { publicationVersion: "desc" },
      include: { chunks: { where: { chunkIndex: 0 }, select: { sourceSpan: { select: { contentHash: true } } } } },
    });
    const matching = existing.find((item) => item.chunks[0]?.sourceSpan.contentHash === firstHash);
    const publication = policy ? (input.publicationId ? await tx.aiKnowledgePublication.findUnique({ where: { id: input.publicationId } }) : null) :
      matching ?? await tx.aiKnowledgePublication.create({ data: {
        sourceRevisionId: source.id, scopeKey: source.scopeKey,
        publicationVersion: (existing[0]?.publicationVersion ?? 0) + 1,
        status: "RECORD_CONFIRMED", publishedById: source.createdById, publishedAt: source.createdAt,
      } });
    if (!publication || publication.sourceRevisionId !== source.id || publication.scopeKey !== source.scopeKey ||
        !isAuthoritativeKnowledgeSource({ originKind: source.originKind, authorityStatus: source.authorityStatus,
          projectId: source.projectId, publicationStatus: policy ? publication.status : null })) {
      throw new Error("Source revision is not authoritative for retrieval.");
    }
    const created = [];
    let chunkIndex = 0;
    for (const span of input.spans) {
      if (!span.text.trim() || span.text.length > 200_000 ||
          (span.pageNumber !== undefined && span.pageNumber < 1) ||
          (span.textStart !== undefined && span.textStart < 0) ||
          (span.textEnd !== undefined && span.textStart !== undefined && span.textEnd <= span.textStart)) {
        throw new Error("Invalid source span.");
      }
      const locator = { pageNumber: span.pageNumber, sheetName: span.sheetName,
        cellRange: span.cellRange, xmlPath: span.xmlPath, textStart: span.textStart, textEnd: span.textEnd };
      const spanHash = digest({ sourceRevisionId: source.id, parserVersion: input.parserVersion,
        spanKind: span.spanKind, locator, text: span.text });
      const sourceSpan = await tx.aiSourceSpan.upsert({
        where: { sourceRevisionId_contentHash: { sourceRevisionId: source.id, contentHash: spanHash } },
        create: { id: `ais_${spanHash}`, sourceRevisionId: source.id, scopeKey: source.scopeKey,
          spanKind: span.spanKind, ...locator, quote: span.text.slice(0, 1200),
          normalizedText: span.text, contentHash: spanHash }, update: {},
      });
      for (const chunk of splitKnowledgeText(span.text)) {
        const contentHash = digest({ publicationId: publication.id, spanHash,
          parserVersion: input.parserVersion, chunk });
        const row = await tx.aiKnowledgeChunk.upsert({
          where: { publicationId_chunkIndex: { publicationId: publication.id, chunkIndex } },
          create: { id: `aic_${contentHash}`, publicationId: publication.id,
            sourceSpanId: sourceSpan.id, scopeKey: source.scopeKey, chunkIndex,
            normalizedText: chunk.text, contentHash }, update: {},
        });
        if (row.contentHash !== contentHash) throw new Error("Parser output changed for an existing publication.");
        created.push(row);
        chunkIndex++;
      }
    }
    return { publicationId: publication.id, chunks: created };
  });
}
