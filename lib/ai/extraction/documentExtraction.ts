import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { parsePurchaseOrder } from "@/lib/purchaseOrder";
import { normalizeVendorInvoice } from "@/lib/costflow/vendorInvoice";
import type { GenerationModel } from "@/lib/ai/providers/types";
import { CandidateBatchSchema, type AuthorizedRetrievalSpan } from "@/lib/ai/contracts";
import { extractKnowledgeSpans, splitKnowledgeText } from "@/lib/ai/retrieval/ingestion";
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
  provenance: "DETERMINISTIC" | "MODEL";
  confidence?: number;
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

type XmlLeaf = { tag: string; path: string; value: string; start: number; end: number };

function scanXmlLeaves(xml: string): XmlLeaf[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML entities are unsupported.");
  const leaves: XmlLeaf[] = [];
  const stack: string[] = [];
  const tokens = /<([^>]+)>|([^<]+)/g;
  for (const token of xml.matchAll(tokens)) {
    if (token[2] !== undefined) {
      const value = token[2].trim();
      if (value && stack.length && !value.includes("&")) {
        const start = token.index + token[2].indexOf(value);
        leaves.push({ tag: stack.at(-1)!, path: `/${stack.join("/")}`,
          value, start, end: start + value.length });
      }
      continue;
    }
    const body = token[1].trim();
    if (body.startsWith("?") || body.startsWith("!")) continue;
    if (body.startsWith("/")) {
      const closing = body.slice(1).trim().split(/\s/)[0];
      if (stack.pop() !== closing) throw new Error("Malformed XML nesting.");
      continue;
    }
    if (!body.endsWith("/")) stack.push(body.split(/\s/)[0]);
  }
  if (stack.length) throw new Error("Malformed XML nesting.");
  return leaves;
}

function xmlCandidate(source: DocumentSource, fieldKey: string, leaves: readonly XmlLeaf[], tag: string): DocumentCandidate | null {
  const matches = leaves.filter((leaf) => leaf.tag === tag);
  const selected = tag === "MST" ? matches.filter((leaf) => /\/NBan\/MST$/i.test(leaf.path)) : matches;
  const available = tag === "MST" && selected.length === 0 ? matches : selected;
  if (available.length !== 1) return null;
  const leaf = available[0];
  const raw = leaf.value;
  return { rowKey: "document", fieldKey, value: raw, sourceRevisionId: source.sourceRevisionId,
    sourceText: raw, locator: { xmlPath: leaf.path, textStart: leaf.start, textEnd: leaf.end },
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
    let leaves: XmlLeaf[];
    try { leaves = scanXmlLeaves(xml); }
    catch { return { status: "REFUSED", candidates: [], missing: [], warnings: ["Malformed or unsafe XML."] }; }
    const candidates = Object.entries(mapping).map(([field, tag]) => xmlCandidate(xmlSource, field, leaves, tag));
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
  const lines = Array.isArray(value.lines) ? value.lines : [];
  if (lines.length > 500) return { status: "REFUSED", candidates: [],
    missing: [], warnings: ["IC exceeds 500 rows."] };
  const candidates: DocumentCandidate[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object" || Array.isArray(line)) continue;
    const record = line as Record<string, unknown>;
    const itemId = record.itemId;
    if (typeof itemId !== "string" || !itemId) continue;
    const serialized = JSON.stringify(line);
    const lineStart = text.indexOf(serialized);
    if (lineStart < 0 || text.indexOf(serialized, lineStart + 1) >= 0) continue;
    for (const field of ["quantity", "days", "unitPrice", "vatPercent", "notes"] as const) {
      const raw = record[field];
      if (typeof raw !== "string" && typeof raw !== "number") continue;
      const encoded = JSON.stringify(raw);
      const keyStart = serialized.indexOf(`"${field}":${encoded}`);
      if (keyStart < 0) continue;
      const valueStart = lineStart + keyStart + field.length + 3;
      const fieldValue = String(raw);
      candidates.push({ rowKey: itemId, fieldKey: `buy.${field}`, value: fieldValue,
        sourceRevisionId: source.sourceRevisionId, sourceText: encoded,
        locator: { textStart: valueStart, textEnd: valueStart + encoded.length },
        provenance: "DETERMINISTIC" });
    }
  }
  const coveredRows = new Set(candidates.map((candidate) => candidate.rowKey));
  const complete = candidates.length > 0 && coveredRows.size === lines.length;
  return { status: complete ? "READY" : "INCOMPLETE",
    candidates, missing: complete ? [] : ["IC line values"], warnings: [] };
}

const modelFieldKeys: Record<BuildInput["documentKind"], ReadonlySet<string>> = {
  PO: new Set(["poNumber", "poDate", "currency", "revenue", "clientName", "description"]),
  VAT: new Set(["invoiceNumber", "symbol", "issuedAt", "sellerTaxCode",
    "netAmount", "vatAmount", "grossAmount"]),
  IC: new Set(),
};

async function authorizedPdfChunks(sources: readonly DocumentSource[]) {
  const authorized: AuthorizedRetrievalSpan[] = [];
  const offsets = new Map<string, number>();
  for (const source of sources.filter((item) => item.mimeType === "application/pdf")) {
    const pages = await extractKnowledgeSpans(source.bytes, "application/pdf");
    for (const page of pages.slice(0, 10)) {
      for (const chunk of splitKnowledgeText(page.text)) {
        if (authorized.length >= 100) return { authorized, offsets };
        const spanId = `preview_${createHash("sha256").update(JSON.stringify({
          revision: source.sourceRevisionId, page: page.pageNumber, start: chunk.start,
          end: chunk.end, content: chunk.text,
        })).digest("hex")}`;
        authorized.push({ span: { spanId, sourceRevisionId: source.sourceRevisionId,
          page: page.pageNumber ?? null, cellRange: null, quote: chunk.text.slice(0, 240) },
          content: chunk.text });
        offsets.set(spanId, chunk.start);
      }
    }
  }
  return { authorized, offsets };
}

export async function completeUnsupportedFields(input: {
  documentKind: BuildInput["documentKind"];
  deterministic: DocumentExtractionOutcome;
  authorizedSources: readonly AuthorizedRetrievalSpan[];
  sourceOffsets?: ReadonlyMap<string, number>;
  model: GenerationModel;
  abort: AbortSignal;
}) {
  if (input.deterministic.status === "READY" || !input.authorizedSources.length ||
      input.documentKind === "IC") return { outcome: input.deterministic, providerRequestId: null,
        inputTokens: 0, outputTokens: 0 };
  const missing = input.documentKind === "VAT" ? [...modelFieldKeys.VAT] :
    input.deterministic.missing.filter((key) => modelFieldKeys[input.documentKind].has(key));
  if (!missing.length) return { outcome: input.deterministic, providerRequestId: null,
    inputTokens: 0, outputTokens: 0 };
  try {
    const result = await input.model.extract({ task: "DOCUMENT_EXTRACTION",
      instruction: `Extract only these missing ${input.documentKind} fields: ${missing.join(", ")}. ` +
        "Use only the selected source text. Return null for unreadable values and cite exact source spans.",
      authorizedSources: input.authorizedSources }, input.abort);
    const batch = CandidateBatchSchema.parse(result.output);
    if (batch.task !== "DOCUMENT_EXTRACTION") throw new Error("Wrong model task.");
    const allowed = new Map(input.authorizedSources.map((item) => [item.span.spanId, item]));
    const existing = new Set(input.deterministic.candidates.map((candidate) => candidate.fieldKey));
    const modelCandidates: DocumentCandidate[] = [];
    for (const candidate of batch.candidates) {
      if (!modelFieldKeys[input.documentKind].has(candidate.key) || existing.has(candidate.key) ||
          modelCandidates.some((item) => item.fieldKey === candidate.key) || !candidate.value ||
          candidate.sources.length !== 1) continue;
      const cited = allowed.get(candidate.sources[0].spanId);
      const reference = candidate.sources[0];
      if (!cited || cited.span.sourceRevisionId !== reference.sourceRevisionId ||
          cited.span.page !== reference.page || cited.span.cellRange !== reference.cellRange ||
          cited.span.quote !== reference.quote) continue;
      const raw = candidate.value.trim();
      const first = cited.content.indexOf(raw);
      if (!raw || first < 0 || cited.content.indexOf(raw, first + 1) >= 0) continue;
      const value = candidate.decimalValue ?? raw;
      if (/^(?:revenue|netAmount|vatAmount|grossAmount)$/.test(candidate.key) &&
          !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) continue;
      modelCandidates.push({ rowKey: "document", fieldKey: candidate.key, value,
        sourceRevisionId: cited.span.sourceRevisionId, sourceText: raw,
        locator: { pageNumber: cited.span.page ?? undefined,
          textStart: (input.sourceOffsets?.get(cited.span.spanId) ?? 0) + first,
          textEnd: (input.sourceOffsets?.get(cited.span.spanId) ?? 0) + first + raw.length },
        provenance: "MODEL", confidence: candidate.confidence });
    }
    const combined = [...input.deterministic.candidates, ...modelCandidates];
    const absent = [...modelFieldKeys[input.documentKind]].filter((key) => !combined.some((item) => item.fieldKey === key));
    let status: DocumentExtractionOutcome["status"] = absent.length ? "INCOMPLETE" : "READY";
    if (status === "READY" && input.documentKind === "VAT") {
      try {
        normalizeVendorInvoice(Object.fromEntries(combined.map(({ fieldKey, value }) => [fieldKey, value])) as Parameters<typeof normalizeVendorInvoice>[0]);
      } catch { status = "REFUSED"; }
    }
    return { outcome: { status, candidates: combined, missing: absent,
      warnings: [...input.deterministic.warnings, ...batch.warnings] },
      providerRequestId: result.providerRequestId,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
  } catch {
    return { outcome: { ...input.deterministic, status: "INCOMPLETE" as const,
      warnings: [...input.deterministic.warnings, "Model extraction unavailable; complete manually."] },
      providerRequestId: null, inputTokens: 0, outputTokens: 0 };
  }
}

export async function extractAndPersistDocumentRun(actorId: string, projectId: string, runId: string,
  model?: GenerationModel) {
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
  const claim = await prisma.aiRun.updateMany({ where: {
    id: runId, status: "READY", scopeHash: scope.scopeHash, cancelledAt: null,
  }, data: { status: "RUNNING" } });
  if (claim.count !== 1) throw new Error("Run was already executed or scope changed.");
  try {
  const kinds = new Set(run.sources.map(({ sourceRevision }) => sourceRevision.originKind));
  const documentKind: BuildInput["documentKind"] = kinds.size === 1 && kinds.has("VENDOR_INVOICE_FILE") ? "VAT" :
    kinds.size === 1 && kinds.has("COSTFLOW_IC") ? "IC" : "PO";
  const deterministic = await buildDeterministicCandidates({ documentKind, sources });
  let completed = { outcome: deterministic, providerRequestId: null as string | null,
    inputTokens: 0, outputTokens: 0 };
  if (model && deterministic.status !== "READY" && run.timeoutAt && run.timeoutAt.getTime() > Date.now()) {
    try {
      const chunks = await authorizedPdfChunks(sources);
      completed = await completeUnsupportedFields({ documentKind, deterministic,
        authorizedSources: chunks.authorized, sourceOffsets: chunks.offsets, model,
        abort: AbortSignal.timeout(run.timeoutAt.getTime() - Date.now()) });
    } catch {
      completed = { ...completed, outcome: { ...deterministic, status: "INCOMPLETE",
        warnings: [...deterministic.warnings, "PDF extraction unavailable; complete manually."] } };
    }
  }
  const outcome = completed.outcome;
  await prisma.$transaction(async (tx) => {
    const active = await tx.aiRun.findFirst({ where: { id: runId, status: "RUNNING",
      scopeHash: scope.scopeHash, cancelledAt: null }, select: { id: true } });
    if (!active) throw new Error("Run was cancelled or scope changed.");
    for (const candidate of outcome.candidates) {
      const hash = createHash("sha256").update(JSON.stringify({
        sourceRevisionId: candidate.sourceRevisionId, parserVersion: run.parserVersion,
        locator: candidate.locator, sourceText: candidate.sourceText,
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
        aiValue: candidate.value, rawValue: candidate.sourceText,
        provenance: candidate.provenance,
        confidence: String(candidate.confidence ?? 1),
        sourceSpanId: span.id } });
    }
    await tx.aiRun.update({ where: { id: runId }, data: {
      status: outcome.status === "REFUSED" ? "FAILED" : "SUCCEEDED",
      outcomeCode: outcome.status, failureCode: outcome.status === "REFUSED" ? "REFUSAL" : null,
      providerRequestId: completed.providerRequestId,
      inputTokens: completed.inputTokens, outputTokens: completed.outputTokens,
      completedAt: new Date(),
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { status: outcome.status, reused: false, candidates: outcome.candidates.length,
    missing: outcome.missing, warnings: outcome.warnings };
  } catch (error) {
    await prisma.aiRun.updateMany({ where: { id: runId, status: "RUNNING" },
      data: { status: "FAILED", outcomeCode: "FAILED", failureCode: "INVALID_SCHEMA",
        completedAt: new Date() } });
    throw error;
  }
}
