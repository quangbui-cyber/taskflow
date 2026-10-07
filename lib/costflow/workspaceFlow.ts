import type { PairedRow, Quotation } from "./types";

export type CostFlowWorkspaceMode = "quote" | "paired" | "ic";

export const WORKSPACE_CAPABILITIES = {
  quote: {
    editSales: true,
    editBuying: false,
    editHierarchy: true,
    configureQuotationTotals: true,
    manageIcEvidence: false,
    previewCustomer: true,
    finalizeQuotation: true,
  },
  paired: {
    editSales: true,
    editBuying: true,
    editHierarchy: true,
    configureQuotationTotals: true,
    manageIcEvidence: true,
    previewCustomer: true,
    finalizeQuotation: true,
  },
  ic: {
    editSales: false,
    editBuying: true,
    editHierarchy: false,
    configureQuotationTotals: false,
    manageIcEvidence: true,
    previewCustomer: false,
    finalizeQuotation: false,
  },
} as const satisfies Record<CostFlowWorkspaceMode, Record<string, boolean>>;

export function workspaceSaveLabel(mode: CostFlowWorkspaceMode, saveIc: boolean) {
  if (mode === "ic") return "Lưu nháp IC";
  if (mode === "quote" || !saveIc) return "Chỉ lưu Báo giá";
  return "Lưu Báo giá & IC";
}

export function requestStateLabel(state?: string) {
  return ({
    DRAFT: "Nháp",
    SUBMITTED: "Chờ duyệt",
    RETURNED: "Đã trả",
    REJECTED: "Đã từ chối",
    APPROVED: "Đã duyệt",
    WITHDRAWN: "Đã rút",
  } as Record<string, string>)[state ?? ""] ?? "Chưa có trạng thái";
}

export function newerQuotation(source: Quotation | undefined, quotations: Quotation[] | undefined) {
  if (!source || !quotations?.length) return undefined;
  const latest = quotations.at(-1);
  return latest && latest.id !== source.id ? latest : undefined;
}

export function quotationVersionDate(quotation?: Quotation) {
  if (!quotation?.createdAt) return "";
  const date = new Date(quotation.createdAt);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(date)
    : "";
}

export function rowCompletion(row: PairedRow) {
  const present = (value: string) => value.trim().length > 0;
  const sellChecks = [row.name, row.sell.unit, row.sell.quantity, row.sell.unitPrice, row.sell.vatPercent];
  const buyChecks = [row.name, row.buy.unit, row.buy.quantity, row.buy.unitPrice, row.buy.vatPercent];
  const hasEvidence = row.buy.evidenceIds.length > 0 || present(row.buy.evidenceReason);
  return {
    sell: { complete: sellChecks.filter(present).length, total: sellChecks.length },
    buy: { complete: buyChecks.filter(present).length + Number(hasEvidence), total: buyChecks.length + 1 },
  };
}
