import { calculateQuotationTotals, normalizeQuotationTotalLayout, type QuotationTotalLayoutRow, type QuotationTotalLine } from "./quotationTotals";
import { totals, type CalculatedCost } from "./money";
import { blankPairedRow, normalizePairedRows } from "./pairedDraft";
import { childrenOf, groupAmount, pricedTotal, saleContributors } from "./pairedPricing";
import { quotationOutline, type QuotationOutlineRole } from "./quotationHierarchy";
import type { PairedRow, PairedDraft, Quotation } from "./types";

export type CustomerRow = { id: string; name: string; description: string; depth: number; role: QuotationOutlineRole; numberLabel: string; childCount: number; showSubtotal: boolean; unit: string; quantity: string; unitPrice: string; basis: string; vat: string; notes: string; amount: CalculatedCost | null; summary: boolean };
export type QuotationReadinessIssue = { id: string; message: string; target: "INFO" | "ROW" | "TOTALS"; rowId?: string };
export type CustomerQuotation = { title: string; customer: string; notes: string; number?: number; id?: string; createdAt?: string; totalLines?: ReturnType<typeof calculateQuotationTotals>["lines"]; totalLayout?: QuotationTotalLayoutRow[]; rows: CustomerRow[]; amount: CalculatedCost; amountIncomplete: boolean; incomplete: boolean; issues: QuotationReadinessIssue[] };

export function quotationReadinessIssues(rows: PairedRow[], title: string, customer: string, totalLines: QuotationTotalLine[] = []): QuotationReadinessIssue[] {
  const issues: QuotationReadinessIssue[] = [];
  if (!title.trim()) issues.push({ id: "title", message: "Nhập tên báo giá.", target: "INFO" });
  if (!customer.trim()) issues.push({ id: "customer", message: "Chọn khách hàng.", target: "INFO" });
  const contributors = saleContributors(rows);
  if (!contributors.length) issues.push({ id: "rows", message: "Thêm ít nhất một hạng mục được tính vào báo giá.", target: "ROW" });
  for (const [index, row] of contributors.entries()) {
    const label = row.name.trim() || `Hạng mục ${index + 1}`;
    if (!row.name.trim()) issues.push({ id: `${row.itemId}:name`, message: `${label}: nhập tên hạng mục.`, target: "ROW", rowId: row.itemId });
    if (!row.sell.quantity.trim()) issues.push({ id: `${row.itemId}:quantity`, message: `${label}: nhập số lượng bán.`, target: "ROW", rowId: row.itemId });
    if (!row.sell.unitPrice.trim()) issues.push({ id: `${row.itemId}:unitPrice`, message: `${label}: nhập đơn giá bán.`, target: "ROW", rowId: row.itemId });
    if (!row.sell.vatPercent.trim()) issues.push({ id: `${row.itemId}:vat`, message: `${label}: nhập VAT, dùng 0 nếu không VAT.`, target: "ROW", rowId: row.itemId });
  }
  const itemTotals = pricedTotal(rows, "sell");
  if (!itemTotals.incomplete) {
    const calculated = calculateQuotationTotals(itemTotals, totalLines);
    for (const line of calculated.lines) if (!line.amount) issues.push({ id: `total:${line.id}`, message: `${line.label || "Dòng tính tiền"}: hoàn tất công thức và VAT.`, target: "TOTALS" });
  }
  return issues;
}

export function projectSales(rows: PairedRow[], title: string, customer: string, notes: string, totalLines: QuotationTotalLine[] = [], totalLayout?: QuotationTotalLayoutRow[]): CustomerQuotation {
  const publicRows: CustomerRow[] = [];
  const outline = new Map(quotationOutline(rows).map(entry => [entry.row.itemId, entry]));
  const walk = (parent: string | null, depth: number, descriptive = false, quantityOnly = false) => {
    for (const row of childrenOf(rows, parent).filter(r => !r.saleRemoved)) {
      const children = childrenOf(rows, row.itemId).filter(r => !r.saleRemoved);
      const entry = outline.get(row.itemId)!;
      const structuralGroup = row.rowType === "GROUP";
      const summary = structuralGroup || (!!children.length && row.pricingMode === "DETAIL");
      const contributors = summary ? saleContributors(rows, row.itemId) : [row];
      const rates = [...new Set(contributors.map(c => c.sell.vatPercent).filter(Boolean))];
      const hidePrice = descriptive || structuralGroup;
      const hideQuantity = hidePrice && !quantityOnly;
      // Explicit allowlist: no buy/vendor/evidence/internal-note fields cross this boundary.
      publicRows.push({ id: row.itemId, name: row.name, description: row.description, depth, role: entry.role, numberLabel: entry.numberLabel, childCount: children.length, showSubtotal: structuralGroup ? row.showGroupSubtotal : true, unit: hideQuantity || summary ? "" : row.sell.unit, quantity: hideQuantity || summary ? "" : row.sell.quantity, unitPrice: hidePrice || summary ? "" : row.sell.unitPrice, basis: hidePrice || summary ? "" : row.sell.basis, vat: hidePrice ? "" : rates.length === 1 ? `${rates[0]}%` : rates.map(r => `${r}%`).join(" / "), notes: row.sell.notes, amount: hidePrice && !structuralGroup ? null : groupAmount(rows, row, "sell"), summary });
      if (children.length && row.showChildren) {
        const packageChildren = row.rowType === "ITEM" && row.pricingMode === "PACKAGE";
        walk(row.itemId, depth + 1, descriptive || packageChildren, packageChildren && row.packageChildDisplay === "QUANTITY");
      }
    }
  };
  walk(null, 0);
  const amount = pricedTotal(rows, "sell");
  const custom = calculateQuotationTotals(amount, totalLines);
  const issues = quotationReadinessIssues(rows, title, customer, totalLines);
  return { title, customer, notes, totalLines: custom.lines, totalLayout: normalizeQuotationTotalLayout(totalLines, totalLayout), rows: publicRows, amount: custom.amount, amountIncomplete: custom.incomplete || amount.incomplete, incomplete: issues.length > 0, issues };
}
export function projectDraft(draft: PairedDraft) { return projectSales(draft.rows, draft.title, draft.customer, draft.notes, draft.totalLines, draft.totalLayout); }
export function projectQuotation(quote: Quotation): CustomerQuotation {
  if (quote.salesRows) {
    const rows = normalizePairedRows(quote.salesRows.map(row => ({ ...row, buy: blankPairedRow(row.itemId).buy })));
    return { ...projectSales(rows, quote.title, quote.customer, quote.notes, quote.totalLines, quote.totalLayout), number: quote.number, id: quote.id, createdAt: quote.createdAt };
  }
  return { title: quote.title, customer: quote.customer, notes: quote.notes, number: quote.number, id: quote.id, createdAt: quote.createdAt, incomplete: false, amountIncomplete: false, issues: [],
    rows: quote.lines.map((line, index) => ({ id: line.id, name: line.description, description: "", depth: 0, role: "ITEM" as const, numberLabel: String(index + 1), childCount: 0, showSubtotal: true, unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice, basis: line.basis, vat: `${line.vatPercent}%`, notes: "", amount: line.cost, summary: false })), amount: totals(quote.lines.map(l => l.cost)) };
}
