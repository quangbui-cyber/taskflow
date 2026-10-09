import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { normalizeQuotationTotalLayout, normalizeQuotationTotals } from "./quotationTotals";
import { blankPairedRow, pairedFromLegacy, normalizePairedRows } from "./pairedDraft";
import { calculateLineCost } from "./money";
import { draftLineIssues } from "./budgetDraft";
import { workingIcRevision } from "./budgetRevisions";
import type { FinanceData, IcLine, PairedDraft } from "./types";
import { projectDraft } from "./quotationProjection";
import { saleContributors } from "./pairedPricing";
import { evaluateFormula, normalizeParameterSnapshot, parameterFinalizationIssues, type QuotationParameterSnapshot } from "./quotationParameters";

type Request = { id: string; state: string; creatorId: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function parameterSnapshot(form: FormData, previous?: QuotationParameterSnapshot, source?: QuotationParameterSnapshot) {
  if (!form.has("parameterConfig")) return previous ? structuredClone(normalizeParameterSnapshot(previous)) : source ? structuredClone(normalizeParameterSnapshot(source)) : undefined;
  const value = String(form.get("parameterConfig") ?? "").trim();
  return value ? normalizeParameterSnapshot(JSON.parse(value)) : undefined;
}

function assertCalculatedValues(rows: PairedDraft["rows"], config?: QuotationParameterSnapshot) {
  if (!config) return;
  for (const row of rows) for (const side of ["sell", "buy"] as const) {
    const binding = row[side].parameterBinding;
    if (!binding || binding.mode === "MANUAL" || binding.mode === "OVERRIDDEN") continue;
    for (const field of ["quantity", "days", "unitPrice"] as const) {
      const formula = field === "quantity" ? binding.quantityFormula : field === "days" ? binding.daysFormula : binding.unitPriceFormula;
      if (!formula) continue;
      const evaluated = evaluateFormula(formula, config, binding.moduleId);
      const fieldLabel = field === "quantity" ? "số lượng" : field === "days" ? "số ngày" : "đơn giá";
      if (!evaluated.issue && row[side][field] !== evaluated.value) throw new Error(`${row.name || row.itemId}: ${side === "sell" ? "Bán" : "IC"} ${fieldLabel} không khớp công thức đã áp dụng.`);
    }
  }
}

export function createPairedFromQuoteDraft(data: FinanceData, draftId: string, actorId: string) {
  const source = data.quotationDrafts?.find(draft => draft.id === draftId && draft.createdBy === actorId && draft.workspaceMode === "quote");
  if (!source) throw new Error("Không tìm thấy nháp Báo giá để mở song song.");
  const existing = data.quotationDrafts?.find(draft => draft.createdBy === actorId && draft.workspaceMode === "paired" && draft.sourceQuoteDraftId === source.id);
  if (existing) return existing;
  const rows = normalizePairedRows(source.rows.map(row => ({
    ...structuredClone(row),
    buy: blankPairedRow(row.itemId, row.parentItemId, row.rowType).buy,
    icLineId: undefined,
  })));
  const paired: PairedDraft = {
    ...structuredClone(source),
    linePricingSchemaVersion: 2,
    id: randomUUID(),
    version: 1,
    workspaceMode: "paired",
    sourceQuoteDraftId: source.id,
    rows,
    globalEvidenceIds: [],
    icRevisionId: undefined,
  };
  data.quotationDrafts = [...(data.quotationDrafts ?? []), paired];
  return paired;
}

export async function savePairedDraft(tx: Prisma.TransactionClient, projectId: string, actorId: string, data: FinanceData, requests: Request[], form: FormData) {
  const id = String(form.get("draftId") ?? "");
  const previous = data.quotationDrafts?.find(d => d.id === id);
  if (id && (!previous || previous.createdBy !== actorId)) throw new Error("Nháp không thuộc project hoặc người lập.");
  let rows = normalizePairedRows(JSON.parse(String(form.get("rows") ?? "[]")));
  const clientId = String(form.get("clientId") ?? "");
  const client = clientId ? await tx.client.findUnique({ where: { id: clientId }, select: { name: true } }) : null;
  if (clientId && !client) throw new Error("Khách hàng không còn trong danh mục.");
  const sourceId = previous?.sourceQuotationId ?? String(form.get("sourceQuotationId") ?? "");
  const source = sourceId ? data.quotations?.find(q => q.id === sourceId) : undefined;
  if (sourceId && !source) throw new Error("Báo giá nguồn không thuộc project.");
  const mode = String(form.get("workspaceMode") ?? previous?.workspaceMode ?? "paired");
  if (!["quote", "paired", "ic"].includes(mode) || (previous?.workspaceMode && previous.workspaceMode !== mode)) throw new Error("Chế độ nháp không hợp lệ.");
  if (mode === "ic") {
    if (!source) throw new Error("Chọn báo giá nguồn để lập IC.");
    const sourceRows = normalizePairedRows(pairedFromLegacy(source, undefined));
    if (rows.length !== sourceRows.length || sourceRows.some(row => !rows.some(input => input.itemId === row.itemId))) throw new Error("Giữ nguyên hạng mục của báo giá nguồn.");
    rows = sourceRows.map(row => ({ ...row, buy: rows.find(input => input.itemId === row.itemId)!.buy, icLineId: rows.find(input => input.itemId === row.itemId)!.icLineId }));
    if (form.get("command") === "FINALIZE_PAIRED_QUOTATION") throw new Error("Trang IC không thay đổi báo giá đã lưu.");
  }
  const totalLines = mode === "ic" ? source?.totalLines ?? [] : normalizeQuotationTotals(JSON.parse(String(form.get("totalLines") ?? JSON.stringify(previous?.totalLines ?? []))));
  const totalLayout = normalizeQuotationTotalLayout(totalLines, mode === "ic" ? source?.totalLayout : JSON.parse(String(form.get("totalLayout") ?? JSON.stringify(previous?.totalLayout ?? []))));
  const working = workingIcRevision(data, requests);
  let revision = mode === "quote" ? undefined : previous?.icRevisionId ? data.revisions.find(r => r.id === previous.icRevisionId) : working;
  const request = requests.find(r => r.id === revision?.requestId);
  const editable = !revision || (request?.state === "DRAFT" && request.creatorId === actorId && !revision.effective);
  if (editable && revision && working && working.id !== revision.id) throw new Error("Tiếp tục revision đang xử lý trước.");
  const globalIds = form.has("globalEvidenceIds") ? JSON.parse(String(form.get("globalEvidenceIds"))) as string[] : previous?.globalEvidenceIds ?? [];
  if (!Array.isArray(globalIds) || globalIds.some(id => typeof id !== "string")) throw new Error("Minh chứng toàn IC không hợp lệ.");
  const parameterConfig = parameterSnapshot(form, previous?.parameterConfig, source?.parameterConfig);
  assertCalculatedValues(rows, parameterConfig);
  const evidenceIds = [...new Set([...globalIds, ...rows.flatMap(r => r.buy.evidenceIds)])];
  if (evidenceIds.length && await tx.costFlowEvidence.count({ where: { projectId, id: { in: evidenceIds } } }) !== evidenceIds.length) throw new Error("Minh chứng không thuộc project.");
  if (rows.some(row => row.buy.vendorId && !data.beneficiaries.some(b => b.id === row.buy.vendorId))) throw new Error("NCC không thuộc project.");
  for (const row of rows) if (row.icLineId && !revision?.lines.some(line => line.id === row.icLineId)) throw new Error("Dòng IC không thuộc phiên bản đang làm.");
  const title = String(form.get("title") ?? "").trim().slice(0, 500);
  const draft: PairedDraft = { linePricingSchemaVersion: 2, id: previous?.id ?? randomUUID(), version: (previous?.version ?? 0) + 1, createdBy: actorId, workspaceMode: mode as PairedDraft["workspaceMode"], parameterConfig: parameterConfig ? structuredClone(parameterConfig) : undefined, totalLines, totalLayout, title, clientId, customer: client?.name ?? previous?.customer ?? source?.customer ?? "", notes: String(form.get("notes") ?? "").slice(0, 5000), rows, sourceQuotationId: sourceId || undefined, latestQuotationId: previous?.latestQuotationId, globalEvidenceIds: [...new Set(globalIds)], reuseSource: previous?.reuseSource, priceReviewRequired: previous?.priceReviewRequired };
  if (editable && mode !== "quote" && form.get("saveIc") !== "no") {
    const lines: IcLine[] = rows.filter(row => row.rowType !== "GROUP" && !rows.some(child => child.parentItemId === row.itemId)).map(row => {
      const retained = revision?.lines.find(line => line.id === row.icLineId || line.itemId === row.itemId);
      const input = row.buy;
      const description = row.name || row.description;
      const line: IcLine = { ...input, parameterBinding: input.parameterBinding ? structuredClone(input.parameterBinding) : undefined, id: retained?.id ?? randomUUID(), itemId: row.itemId, description, unit: input.unit, cost: draftLineIssues({ ...input, description }).length ? null : calculateLineCost(input), evidenceIds: [...input.evidenceIds], evidenceReason: input.evidenceReason, internalNotes: input.notes,
        ...(input.vendorId ? { vendorId: input.vendorId } : {}), ...(retained?.originLines ? { originLines: retained.originLines } : {}), ...(retained?.quotationId ? { quotationId: retained.quotationId, quotationLineId: retained.quotationLineId } : source && row.quotationLineId ? { quotationId: source.id, quotationLineId: row.quotationLineId } : {}) };
      row.icLineId = line.id; return line;
    });
    // Even a forged stale/deleted sale row cannot delete accrued IC/evidence.
    for (const line of revision?.lines ?? []) if (!lines.some(l => l.id === line.id) && (line.unitPrice || line.evidenceIds?.length || line.evidenceReason || data.expenses.some(e => e.revisionId === revision?.id && e.lineId === line.id))) lines.push(line);
    if (new Set(lines.map(l=>l.id)).size !== lines.length) throw new Error("Hai hạng mục không được ghi đè cùng dòng IC.");
    if (lines.length > 500) throw new Error("IC tối đa 500 dòng.");
    if (!revision) {
      const request = await tx.workflowRequest.create({ data: { projectId, module: "COSTFLOW", kind: "IC", title: `IC — ${title || "Dự toán"}`, creatorId: actorId, cashAssigneeId: actorId, state: "DRAFT", steps: [], payload: {} } });
      revision = { linePricingSchemaVersion: 2, id: randomUUID(), number: data.revisions.length + 1, requestId: request.id, effective: false, createdBy: actorId, lines, poIds: [], briefIds: [], evidenceIds: [] };
      data.revisions.push(revision);
    }
    revision.pairedDraftId = draft.id;
    revision.linePricingSchemaVersion = 2;
    revision.parameterConfig = parameterConfig ? structuredClone(parameterConfig) : undefined;
    if (draft.latestQuotationId || draft.sourceQuotationId) revision.quotationId = draft.latestQuotationId ?? draft.sourceQuotationId;
    revision.tree = rows.map(r => ({ itemId: r.itemId, parentItemId: r.parentItemId, name: r.name, description: r.description }));
    revision.lines = lines; revision.evidenceIds = [...draft.globalEvidenceIds];
    await tx.workflowRequest.update({ where: { id: revision.requestId }, data: { payload: json(revision), version: { increment: 1 } } });
    data.workingRevisionId = revision.id;
  } else {
    // Never persist client-supplied replacements of a submitted IC snapshot.
    for (const row of rows) {
      const line = revision?.lines.find(line => line.id === row.icLineId || line.itemId === row.itemId);
      row.buy = line ? { quantity: line.quantity, days: line.days, unitPrice: line.unitPrice, vatPercent: line.vatPercent, basis: line.basis, unit: line.unit, notes: line.internalNotes ?? "", parameterBinding: line.parameterBinding ? structuredClone(line.parameterBinding) : undefined, vendorId: line.vendorId ?? "", evidenceIds: [...(line.evidenceIds ?? [])], evidenceReason: line.evidenceReason ?? "" } : { quantity: "", days: "", unitPrice: "", vatPercent: "", basis: "NET", unit: "", notes: "", vendorId: "", evidenceIds: [], evidenceReason: "" };
    }
  }
  if (!editable || form.get("saveIc") === "no") draft.globalEvidenceIds = [...(revision?.evidenceIds ?? previous?.globalEvidenceIds ?? [])];
  draft.icRevisionId = revision?.id;
  data.quotationDrafts = [...(data.quotationDrafts ?? []).filter(d => d.id !== draft.id), draft];
  return { draftId: draft.id, revisionId: revision?.id, savedScopes: editable && mode !== "quote" && form.get("saveIc") !== "no" ? ["Báo giá", "IC nháp"] : ["Báo giá"], draft };
}

export function finalizePairedQuotation(data: FinanceData, draftId: string, actorId: string, priceReviewConfirmed = false) {
  const draft = data.quotationDrafts?.find(d => d.id === draftId && d.createdBy === actorId);
  if (!draft) throw new Error("Không tìm thấy nháp của người lập.");
  if (draft.workspaceMode === "ic") throw new Error("Trang IC không thay đổi báo giá đã lưu.");
  if (draft.priceReviewRequired && !priceReviewConfirmed) throw new Error("Xác nhận đã rà soát giá bán, VAT và các dòng phí từ nguồn dùng lại trước khi chốt.");
  const parameterIssues = parameterFinalizationIssues(draft.rows, draft.parameterConfig, "sell");
  if (parameterIssues.length) {
    const issue = parameterIssues[0];
    throw new Error(`${issue.rowName || issue.rowId || "Hạng mục"}: ${issue.message}`);
  }
  if (projectDraft(draft).incomplete) throw new Error("Báo giá cần tên, khách hàng và đủ giá bán, số lượng, số ngày, VAT của các dòng đang tính trước khi xuất.");
  const previous = data.quotations?.find(q => q.id === (draft.latestQuotationId ?? draft.sourceQuotationId));
  const lines = saleContributors(draft.rows).map(row => ({ ...row.sell, id: randomUUID(), description: row.name || row.description, cost: calculateLineCost(row.sell), ...(row.quotationLineId && previous?.lines.some(l => l.id === row.quotationLineId) ? { parentQuotationLineId: row.quotationLineId } : {}) }));
  const id = randomUUID();
  // Finalized quote stores sales only; IC evidence/history stays in its original separate records.
    const salesRows = draft.rows.map(row => ({ itemId: row.itemId, parentItemId: row.parentItemId, rowType: row.rowType, name: row.name, description: row.description, pricingMode: row.pricingMode, showChildren: row.showChildren, showGroupSubtotal: row.showGroupSubtotal, packageChildDisplay: row.packageChildDisplay, saleRemoved: row.saleRemoved, sell: structuredClone(row.sell), quotationLineId: lines[saleContributors(draft.rows).findIndex(r => r.itemId === row.itemId)]?.id }));
  data.quotations = [...(data.quotations ?? []), { linePricingSchemaVersion: 2, id, number: (data.quotations?.length ?? 0) + 1, parentId: previous?.id ?? null, parameterConfig: draft.parameterConfig ? structuredClone(draft.parameterConfig) : undefined, totalLines: structuredClone(draft.totalLines ?? []), totalLayout: structuredClone(draft.totalLayout ?? []), title: draft.title, customer: draft.customer, notes: draft.notes, lines, salesRows, poIds: [...(previous?.poIds ?? [])], briefIds: [...(previous?.briefIds ?? [])], evidenceIds: [...(previous?.evidenceIds ?? [])], createdBy: actorId, createdAt: new Date().toISOString() }];
  draft.latestQuotationId = id;
  delete draft.reuseSource;
  draft.priceReviewRequired = false;
  for (const row of draft.rows) row.quotationLineId = salesRows.find(r => r.itemId === row.itemId)?.quotationLineId;
  return id;
}
