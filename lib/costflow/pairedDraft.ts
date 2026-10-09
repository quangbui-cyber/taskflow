import { compare, decimal, normalizeDecimalInput } from "./money";
import { normalizeParameterBinding } from "./quotationParameters";
import type { FinanceData, IcRevision, PairedDraft, PairedRow, PairedSide, Quotation } from "./types";

export function blankSide(days = ""): PairedSide {
  return { quantity: "", days, unitPrice: "", vatPercent: "8", basis: "NET", unit: "", notes: "" };
}
export function blankPairedRow(itemId: string, parentItemId: string | null = null, rowType: "GROUP" | "ITEM" = "ITEM"): PairedRow {
  return { itemId, parentItemId, rowType, name: "", description: "", pricingMode: "DETAIL", showChildren: true, showGroupSubtotal: true, packageChildDisplay: "CONTENT",
    sell: blankSide("1"), buy: { ...blankSide(), vendorId: "", evidenceIds: [], evidenceReason: "" } };
}
export function pairedFromLegacy(quotation: Quotation | undefined, revision: IcRevision | undefined): PairedRow[] {
  if (quotation?.salesRows) return quotation.salesRows.map(row => {
    const cost = revision?.lines.find(line => line.itemId === row.itemId || line.quotationLineId === row.quotationLineId);
    return { ...structuredClone(row), sell: { ...structuredClone(row.sell), days: row.sell.days || "1" }, icLineId: cost?.id, buy: { ...blankSide(cost ? cost.days || "1" : ""), ...(cost ?? {}), notes: cost?.internalNotes ?? "", vendorId: cost?.vendorId ?? "", evidenceIds: [...(cost?.evidenceIds ?? [])], evidenceReason: cost?.evidenceReason ?? "" } };
  });
  const rows: PairedRow[] = (quotation?.lines ?? []).map(line => {
    const cost = revision?.lines.find(c => c.quotationId === quotation?.id && c.quotationLineId === line.id);
    return { ...blankPairedRow(line.id), name: line.description, description: line.description, quotationLineId: line.id, icLineId: cost?.id,
      sell: { ...blankSide("1"), ...line, days: line.days || "1" }, buy: { ...blankSide(cost ? cost.days || "1" : ""), ...(cost ?? {}), notes: cost?.internalNotes ?? "", vendorId: cost?.vendorId ?? "", evidenceIds: [...(cost?.evidenceIds ?? [])], evidenceReason: cost?.evidenceReason ?? "" } };
  });
  for (const line of revision?.lines ?? []) if (!rows.some(row => row.icLineId === line.id)) rows.push({ ...blankPairedRow(line.itemId ?? line.id), name: line.description, description: line.description, icLineId: line.id,
    buy: { ...blankSide(line.days || "1"), ...line, days: line.days || "1", notes: line.internalNotes ?? "", vendorId: line.vendorId ?? "", evidenceIds: [...(line.evidenceIds ?? [])], evidenceReason: line.evidenceReason ?? "" } });
  return rows;
}
function cleanSide(value: unknown): PairedSide {
  const side = value as Partial<PairedSide> | null;
  if (!side || !["NET", "GROSS"].includes(side.basis ?? "")) throw new Error("Chọn net hoặc gross cho từng phía.");
  const out: PairedSide = { ...blankSide(), unit: String(side.unit ?? "").slice(0, 100), notes: String(side.notes ?? "").slice(0, 5000), basis: side.basis!, parameterBinding: normalizeParameterBinding(side.parameterBinding) };
  for (const field of ["quantity", "days", "unitPrice", "vatPercent"] as const) {
    const raw = String(side[field] ?? "").trim();
    out[field] = raw ? normalizeDecimalInput(raw) : "";
    if (out[field] && compare(decimal(out[field]), decimal("0")) < 0) throw new Error("Số lượng, đơn giá và VAT không được âm.");
  }
  return out;
}
export function normalizePairedRows(input: unknown): PairedRow[] {
  if (!Array.isArray(input) || input.length > 500) throw new Error("Bảng tối đa 500 hạng mục.");
  const rawRows = input as Partial<PairedRow>[];
  const rows = input.map(value => {
    if (!value || typeof value !== "object") throw new Error("Hạng mục không hợp lệ.");
    const row = value as PairedRow;
    if (!/^[\w-]{1,100}$/.test(row.itemId ?? "") || !["PACKAGE", "DETAIL"].includes(row.pricingMode)) throw new Error("Mã dòng hoặc cách định giá không hợp lệ.");
    if (!Array.isArray(row.buy?.evidenceIds) || row.buy.evidenceIds.some(id => typeof id !== "string")) throw new Error("Liên kết minh chứng không hợp lệ.");
    const inferredType = !row.parentItemId && rawRows.some(candidate => candidate && typeof candidate === "object" && candidate.parentItemId === row.itemId) ? "GROUP" : "ITEM";
    const rowType = row.rowType === "GROUP" || row.rowType === "ITEM" ? row.rowType : inferredType;
    const packageChildDisplay: PairedRow["packageChildDisplay"] = row.packageChildDisplay === "QUANTITY" ? "QUANTITY" : "CONTENT";
    return { itemId: row.itemId, parentItemId: row.parentItemId || null, rowType, name: String(row.name ?? "").slice(0, 500), description: String(row.description ?? "").slice(0, 5000), pricingMode: row.pricingMode, showChildren: row.showChildren !== false, showGroupSubtotal: row.showGroupSubtotal !== false, packageChildDisplay, saleRemoved: row.saleRemoved === true,
      quotationLineId: row.quotationLineId, icLineId: row.icLineId, sell: cleanSide(row.sell), buy: { ...cleanSide(row.buy), vendorId: String(row.buy.vendorId ?? ""), evidenceIds: [...new Set(row.buy.evidenceIds)], evidenceReason: String(row.buy.evidenceReason ?? "").trim().slice(0, 5000) } };
  });
  const ids = new Set(rows.map(row => row.itemId));
  if (ids.size !== rows.length) throw new Error("Mã hạng mục bị trùng.");
  for (const row of rows) {
    if (row.rowType === "GROUP" && row.parentItemId) throw new Error("Nhóm chỉ được đặt ở cấp gốc.");
    const visited = new Set([row.itemId]); let parent = row.parentItemId;
    while (parent) {
      if (!ids.has(parent) || visited.has(parent)) throw new Error("Nhóm cha không hợp lệ hoặc có vòng tham chiếu.");
      visited.add(parent); parent = rows.find(r => r.itemId === parent)!.parentItemId;
    }
    if (row.rowType !== "GROUP" && rows.some(child => child.parentItemId === row.itemId) && (row.buy.unitPrice || row.buy.evidenceIds.length || row.buy.evidenceReason)) throw new Error(`Hạng mục ${row.name || row.itemId} đang có chi phí riêng. Giữ nó là dòng chi phí; chọn một nhóm cha riêng để tránh cộng trùng.`);
  }
  return rows;
}
export function pairedDraftMetadata(draft: PairedDraft) {
  return { id: draft.id, version: draft.version, icRevisionId: draft.icRevisionId };
}

export function hydrateLegacyPairedDraft(draft: PairedDraft): PairedDraft {
  if (draft.linePricingSchemaVersion === 2) return structuredClone(draft);
  const hydrated = structuredClone(draft);
  hydrated.rows = hydrated.rows.map(row => ({
    ...row,
    sell: { ...row.sell, days: row.sell.days || "1" },
    buy: {
      ...row.buy,
      days: row.buy.days || (row.buy.quantity || row.buy.unitPrice ? "1" : ""),
    },
  }));
  return hydrated;
}

export function hydrateLinePricingData(source: FinanceData): FinanceData {
  const data = structuredClone(source);
  data.quotationDrafts = data.quotationDrafts?.map(hydrateLegacyPairedDraft);
  data.quotations = data.quotations?.map(quotation => ({
    ...quotation,
    lines: quotation.lines.map(line => ({ ...line, days: line.days || "1" })),
    salesRows: quotation.salesRows?.map(row => ({ ...row, sell: { ...row.sell, days: row.sell.days || "1" } })),
  }));
  data.revisions = data.revisions.map(revision => ({
    ...revision,
    lines: revision.lines.map(line => ({ ...line, days: line.days || "1" })),
    submissions: revision.submissions?.map(submission => ({
      ...submission,
      lines: submission.lines.map(line => ({ ...line, days: line.days || "1" })),
    })),
  }));
  return data;
}
