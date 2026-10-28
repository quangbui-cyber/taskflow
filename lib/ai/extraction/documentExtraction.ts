import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { parsePurchaseOrder } from "@/lib/purchaseOrder";
import { normalizeVendorInvoice } from "@/lib/costflow/vendorInvoice";
import type { GenerationModel } from "@/lib/ai/providers/types";
import { AiSourceNotFoundError, resolveAiReadScope } from "@/lib/ai/access/resolveAiReadScope";
import { readAiRun } from "@/lib/ai/runs/aiRunService";
import { prismaAiSourceStore } from "@/lib/ai/sources/sourceRevisions";
import { prisma } from "@/lib/prisma";

export type DocumentSource = {
  sourceRevisionId: string;
  mimeType: string;
  role: "PRIMARY" | "XML" | "PDF";
  bytes: Uint8Array;
};

export type DocumentCandidate = {
  rowKey: string;
  fieldKey: string;
  value: string;
  sourceRevisionId: string;
  sourceText: string;
  locator: {
    pageNumber?: number;
    cellRange?: string;
    xmlPath?: string;
    textStart?: number;
    textEnd?: number;
  };
  provenance: "DETERMINISTIC";
};

export type DocumentExtractionOutcome = {
  status: "READY" | "INCOMPLETE" | "REFUSED";
  candidates: DocumentCandidate[];
  missing: string[];
  warnings: string[];
};

type BuildInput = {
  documentKind: "PO" | "VAT" | "IC";
  sources: readonly DocumentSource[];
  model?: GenerationModel;
};

function plainCandidate(source: DocumentSource, fieldKey: string, text: string, match: RegExpMatchArray | null): DocumentCandidate | null {
  if (!match || match.index === undefined || !match[0]) return null;
  const value = match[1] ?? match[0];
  const relative = match[0].indexOf(value);
  const start = match.index + Math.max(relative, 0);
  return { rowKey: "document", fieldKey, value, sourceRevisionId: source.sourceRevisionId,
    sourceText: value, locator: { textStart: start, textEnd: start + value.length },
    provenance: "DETERMINISTIC" };
}

function xmlCandidate(source: DocumentSource, fieldKey: string, xml: string, tag: string): DocumentCandidate | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]+)<\\/${tag}>`, "i").exec(xml);
  if (!match?.[1] || match.index === undefined) return null;
  const raw = match[1].trim();
  if (!raw || /&(?:#|[a-z])/i.test(raw)) return null;
  const start = match.index + match[0].indexOf(match[1]);
  return { rowKey: "document", fieldKey, value: raw, sourceRevisionId: source.sourceRevisionId,
    sourceText: raw, locator: { xmlPath: `/HDon/${tag}`, textStart: start, textEnd: start + match[1].length },
    provenance: "DETERMINISTIC" };
}

function result(candidates: Array<DocumentCandidate | null>, required: readonly string[], warnings: string[] = []): DocumentExtractionOutcome {
  const present = candidates.filter((candidate): candidate is DocumentCandidate => candidate !== null);
  const missing = required.filter((key) => !present.some((candidate) => candidate.fieldKey === key));
  return { status: missing.length ? "INCOMPLETE" : "READY", candidates: present, missing, warnings };
}

export async function buildDeterministicCandidates(input: BuildInput): Promise<DocumentExtractionOutcome> {
  // Model extraction of unknown fields is delegated to the bounded run executor.
  // This adapter emits only exact values that can be tied to source coordinates.
  if (input.documentKind === "VAT") {
    const xmlSource = input.sources.find((source) => source.role === "XML" &&
      ["application/xml", "text/xml"].includes(source.mimeType));
    if (!xmlSource || input.sources.filter((source) => source.role === "XML").length !== 1 ||
        input.sources.length > 2 || input.sources.some((source) => source !== xmlSource && source.role !== "PDF")) {
      return { status: "REFUSED", candidates: [], missing: [], warnings: ["One registered XML invoice is required."] };
    }
    let xml: string;
    try { xml = new TextDecoder("utf-8", { fatal: true }).decode(xmlSource.bytes); }
    catch { return { status: "REFUSED", candidates: [], missing: [], warnings: ["Unreadable XML bytes."] }; }
    const mapping = {
      invoiceNumber: "SHDon", symbol: "KHHDon", issuedAt: "NLap",
      sellerTaxCode: "MST", netAmount: "TgTCThue", vatAmount: "TgTThue", grossAmount: "TgTTTBSo",
    } as const;
    const candidates = Object.entries(mapping).map(([field, tag]) => xmlCandidate(xmlSource, field, xml, tag));
    const outcome = result(candidates, Object.keys(mapping));
    if (outcome.status === "READY") {
      try {
        normalizeVendorInvoice(Object.fromEntries(outcome.candidates.map(({ fieldKey, value }) => [fieldKey, value])) as Parameters<typeof normalizeVendorInvoice>[0]);
      } catch {
        return { ...outcome, status: "REFUSED", warnings: ["Invoice identity, date or totals failed deterministic validation."] };
      }
    }
    return outcome;
  }

  if (input.documentKind === "PO") {
    if (input.sources.length !== 1) return { status: "REFUSED", candidates: [], missing: [], warnings: ["Select one PO."] };
    const source = input.sources[0];
    let text: string;
    let pageTexts: string[] = [];
    if (source.mimeType === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const document = await getDocumentProxy(Uint8Array.from(source.bytes));
      try {
        pageTexts = (await extractText(document)).text.slice(0, 5);
        text = pageTexts.join("\n\n");
      }
      finally { await document.cleanup(); }
    } else if (source.mimeType === "text/plain") {
      text = new TextDecoder("utf-8", { fatal: true }).decode(source.bytes);
    } else return { status: "REFUSED", candidates: [], missing: [], warnings: ["Unsupported PO format."] };
    let parsed: ReturnType<typeof parsePurchaseOrder>;
    try { parsed = parsePurchaseOrder(text); }
    catch { return { status: "REFUSED", candidates: [], missing: [], warnings: ["Unsupported PO template."] }; }
    const outcome = result([
      plainCandidate(source, "poNumber", text, text.match(/\b(C-\d{8,})\b/i)),
      plainCandidate(source, "poDate", text, text.match(/\bC-\d{8,}\s+(\d{2}\/\d{2}\/\d{4})\b/i)),
      plainCandidate(source, "currency", text, text.match(/\b(VND|USD|EUR)\b/)),
      plainCandidate(source, "revenue", text, text.match(/\b[0-9][0-9,.]*\s+Units\s+([0-9][0-9,.]*)\s+(?:VND|USD|EUR)\b/i)),
    ], ["poNumber", "poDate", "currency", "revenue"]);
    if (parsed.items.length === 0) { outcome.status = "INCOMPLETE"; outcome.missing.push("items"); }
    if (pageTexts.length) {
      for (const candidate of outcome.candidates) {
        const offset = candidate.locator.textStart ?? -1;
        let pageStart = 0;
        for (const [index, page] of pageTexts.entries()) {
          if (offset >= pageStart && offset < pageStart + page.length) {
            candidate.locator.pageNumber = index + 1;
            candidate.locator.textStart = offset - pageStart;
            candidate.locator.textEnd = candidate.locator.textStart + candidate.sourceText.length;
            break;
          }
          pageStart += page.length + 2;
        }
      }
    }
    return outcome;
  }

  if (input.sources.length !== 1 || input.sources[0].mimeType !== "application/json") {
    return { status: "REFUSED", candidates: [], missing: [], warnings: ["Select one versioned IC record."] };
  }
  const source = input.sources[0];
  let value: Record<string, unknown>;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source.bytes);
    value = JSON.parse(text) as Record<string, unknown>;
  } catch { return { status: "REFUSED", candidates: [], missing: [], warnings: ["Unreadable IC record."] }; }
  const candidates = ["id", "number", "requestId"].map((fieldKey) => {
    const raw = value[fieldKey];
    if (typeof raw !== "string" && typeof raw !== "number") return null;
    const exact = JSON.stringify(raw);
    return plainCandidate(source, fieldKey, text, text.match(new RegExp(`"${fieldKey}"\\s*:\\s*(${exact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)));
  });
  return result(candidates, ["id", "number", "requestId"]);
}

export async function extractAndPersistDocumentRun(actorId: string, projectId: string, runId: string) {
  await readAiRun(actorId, projectId, runId);
  const run = await prisma.aiRun.findFirst({ where: { id: runId, projectId, actorId },
    include: { sources: { include: { sourceRevision: true } } } });
  if (!run || run.runType !== "DOCUMENT_EXTRACTION") throw new AiSourceNotFoundError();
  if (run.status === "SUCCEEDED" || run.status === "FAILED") {
    return { status: run.outcomeCode ?? run.status, reused: true };
  }
  if (run.status !== "READY" || run.cancelledAt) throw new AiSourceNotFoundError();
  const refs = run.sources.map(({ sourceRevision }) => `${sourceRevision.originKind}:${sourceRevision.originId}`);
  const scope = await resolveAiReadScope(actorId, { projectId, sourceIds: refs, purpose: run.runType });
  if (scope.scopeHash !== run.scopeHash) throw new AiSourceNotFoundError();
  const sources: DocumentSource[] = [];
  for (const linked of run.sources) {
    const revision = linked.sourceRevision;
    const metadata = scope.sources.find((item) => item.kind === revision.originKind && item.id === revision.originId);
    if (!metadata || metadata.version !== revision.originVersion) throw new AiSourceNotFoundError();
    const bytes = revision.snapshotBytes ?? await prismaAiSourceStore.readBytes(metadata);
    if (createHash("sha256").update(bytes).digest("hex") !== revision.sha256) throw new AiSourceNotFoundError();
    sources.push({ sourceRevisionId: revision.id, mimeType: revision.mimeType,
      role: linked.role as DocumentSource["role"], bytes });
  }
  const kinds = new Set(run.sources.map(({ sourceRevision }) => sourceRevision.originKind));
  const documentKind: BuildInput["documentKind"] = kinds.size === 1 && kinds.has("VENDOR_INVOICE_FILE") ? "VAT" :
    kinds.size === 1 && kinds.has("COSTFLOW_IC") ? "IC" : "PO";
  const outcome = await buildDeterministicCandidates({ documentKind, sources });
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.aiRun.updateMany({ where: { id: runId, status: "READY", scopeHash: scope.scopeHash },
      data: { status: "RUNNING" } });
    if (claimed.count !== 1) throw new Error("Run was already executed or scope changed.");
    for (const candidate of outcome.candidates) {
      const hash = createHash("sha256").update(JSON.stringify({
        runId, sourceRevisionId: candidate.sourceRevisionId, parserVersion: run.parserVersion,
        fieldKey: candidate.fieldKey, locator: candidate.locator, value: candidate.value,
      })).digest("hex");
      const span = await tx.aiSourceSpan.upsert({
        where: { sourceRevisionId_contentHash: { sourceRevisionId: candidate.sourceRevisionId, contentHash: hash } },
        create: { id: `ais_${hash}`, sourceRevisionId: candidate.sourceRevisionId, scopeKey: run.scopeKey,
          spanKind: candidate.locator.xmlPath ? "XML" : "TEXT", ...candidate.locator,
          quote: candidate.sourceText.slice(0, 240), normalizedText: candidate.sourceText,
          contentHash: hash }, update: {},
      });
      await tx.aiCandidateField.create({ data: { runId, scopeKey: run.scopeKey,
        rowKey: candidate.rowKey, fieldKey: candidate.fieldKey,
        aiValue: candidate.value, rawValue: candidate.value,
        provenance: "DETERMINISTIC", confidence: "1",
        sourceSpanId: span.id } });
    }
    await tx.aiRun.update({ where: { id: runId }, data: {
      status: outcome.status === "REFUSED" ? "FAILED" : "SUCCEEDED",
      outcomeCode: outcome.status, failureCode: outcome.status === "REFUSED" ? "REFUSAL" : null,
      completedAt: new Date(),
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { status: outcome.status, reused: false, candidates: outcome.candidates.length,
    missing: outcome.missing, warnings: outcome.warnings };
}
