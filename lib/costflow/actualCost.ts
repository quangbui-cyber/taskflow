import {
  calculateLineCost,
  compare,
  decimal,
  exact,
  round,
  source,
  subtract,
  totals,
  type CalculatedCost,
} from "./money";
import type { ActualCostFundingSource } from "./types";
export type { ActualCostFundingSource };

export const ACTUAL_COST_FUNDING_SOURCES = [
  "EMPLOYEE_ADVANCE",
  "EMPLOYEE_OUT_OF_POCKET",
  "VENDOR_ADVANCE",
  "VENDOR_PAYMENT",
] as const satisfies readonly ActualCostFundingSource[];

export const ACTUAL_COST_SHEET_STATES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "RETURNED",
] as const;
export type ActualCostSheetState = typeof ACTUAL_COST_SHEET_STATES[number];

export const ACTUAL_COST_INTERNAL_STATUSES = [
  "IN_PROGRESS",
  "NEEDS_INFO",
  "PENDING_ACCOUNT_REVIEW",
  "ACCOUNT_REVIEWED",
] as const;
export type ActualCostInternalStatus = typeof ACTUAL_COST_INTERNAL_STATUSES[number];

export type ActualCostFundingAllocation = {
  source: ActualCostFundingSource;
  amount: string;
  note?: string;
};

export const ACTUAL_COST_EVIDENCE_KINDS = [
  "VENDOR_CONTRACT_PO",
  "ACCEPTANCE_HANDOVER",
  "VAT_INVOICE",
  "PAYMENT_PROOF",
  "FIELD_PHOTO_REPORT",
] as const;
export type ActualCostEvidenceKind = typeof ACTUAL_COST_EVIDENCE_KINDS[number];

const REQUIRED_ACTUAL_COST_EVIDENCE = ["ACCEPTANCE_HANDOVER", "VAT_INVOICE", "PAYMENT_PROOF"] as const;

export function normalizeActualCostEvidenceKind(value: string): ActualCostEvidenceKind {
  if (!ACTUAL_COST_EVIDENCE_KINDS.includes(value as ActualCostEvidenceKind)) throw new Error("Loại chứng từ AC không hợp lệ.");
  return value as ActualCostEvidenceKind;
}

export function actualCostEvidenceWarnings(kinds: string[]) {
  const present = new Set(kinds);
  return REQUIRED_ACTUAL_COST_EVIDENCE.filter(kind => !present.has(kind)).map(kind => `MISSING_${kind}`);
}

export type ActualCostDecisionAction = "APPROVED" | "RETURNED";
export type ActualCostSourceKind = "IC_LINKED" | "UNBUDGETED";

export function calculateActualCost(input: { quantity: string; days: string; unitPrice: string; basis?: "NET" | "GROSS"; vatPercent?: string }) {
  const quantity = decimal(input.quantity);
  const days = decimal(input.days);
  const unitPrice = decimal(input.unitPrice);
  const zero = decimal("0");
  if (compare(quantity, zero) <= 0 || compare(days, zero) <= 0 || compare(unitPrice, zero) < 0) {
    throw new Error("Số lượng và số ngày phải lớn hơn 0; đơn giá không được âm.");
  }
  const cost = calculateLineCost({
    quantity: input.quantity,
    days: input.days,
    unitPrice: input.unitPrice,
    basis: input.basis ?? "GROSS",
    vatPercent: input.vatPercent ?? "0",
  });
  return { amount: cost.gross, rawAmount: cost.rawGross, cost };
}

export function actualCostVariance(ic: CalculatedCost, rows: CalculatedCost[]) {
  const actual = totals(rows);
  const variance = {
    rawNet: source(subtract(exact(actual.rawNet), exact(ic.rawNet))),
    rawVat: source(subtract(exact(actual.rawVat), exact(ic.rawVat))),
    rawGross: source(subtract(exact(actual.rawGross), exact(ic.rawGross))),
    net: round(subtract(exact(actual.rawNet), exact(ic.rawNet))),
    vat: round(subtract(exact(actual.rawVat), exact(ic.rawVat))),
    gross: round(subtract(exact(actual.rawGross), exact(ic.rawGross))),
  };
  const gross = compare(exact(variance.rawGross), decimal("0"));
  return { ic, actual, variance, status: gross > 0 ? "OVER_BUDGET" as const : gross < 0 ? "SAVING" as const : "ON_BUDGET" as const };
}

export type UnbudgetedActualCostInput = {
  description: string;
  reason: string;
  fundingSource: string;
  recipientKey: string;
  quantity: string;
  days: string;
  unitPrice: string;
  unit: string;
  basis?: "NET" | "GROSS";
  vatPercent?: string;
  evidenceIds: string[];
  billable: boolean;
  saleQuantity?: string;
  saleDays?: string;
  saleUnitPrice?: string;
};

export function validateUnbudgetedActualCost(input: UnbudgetedActualCostInput) {
  const required = (value: string, label: string) => {
    const normalized = value.trim();
    if (!normalized) throw new Error(`Thiếu ${label}.`);
    return normalized;
  };
  const description = required(input.description, "nội dung phát sinh");
  const reason = required(input.reason, "lý do phát sinh");
  const fundingSource = normalizeActualCostFundingSource(input.fundingSource);
  const recipientKey = required(input.recipientKey, "người nhận");
  const unit = required(input.unit, "đơn vị");
  const evidenceIds = [...new Set(input.evidenceIds.map(value => value.trim()).filter(Boolean))];
  if (!evidenceIds.length) throw new Error("Cần ít nhất một chứng từ cho phát sinh ngoài IC.");
  const calculated = calculateActualCost(input);
  let saleSnapshot: { quantity: string; days: string; unitPrice: string } | null = null;
  if (input.billable) {
    const quantity = required(input.saleQuantity ?? "", "số lượng bán thêm");
    const days = required(input.saleDays ?? "", "số ngày bán thêm");
    const unitPrice = required(input.saleUnitPrice ?? "", "đơn giá bán thêm");
    calculateActualCost({ quantity, days, unitPrice });
    saleSnapshot = { quantity, days, unitPrice };
  }
  return { description, reason, fundingSource, recipientKey, unit, evidenceIds, billable: input.billable, saleSnapshot, ...calculated };
}

export function normalizeActualCostFundingSource(value: string): ActualCostFundingSource {
  if (!ACTUAL_COST_FUNDING_SOURCES.includes(value as ActualCostFundingSource)) {
    throw new Error("Chọn đúng nguồn thanh toán AC.");
  }
  return value as ActualCostFundingSource;
}

export function validateActualCostFundingAllocations(grossAmount: string, allocations: ActualCostFundingAllocation[]) {
  if (!allocations.length) {
    throw new Error("Phải có ít nhất một nguồn phân bổ.");
  }
  let sum = BigInt(0);
  for (const alloc of allocations) {
    normalizeActualCostFundingSource(alloc.source);
    const amt = BigInt(alloc.amount || "0");
    if (amt <= BigInt(0)) throw new Error("Số tiền phân bổ nguồn phải lớn hơn 0.");
    sum += amt;
  }
  if (sum.toString() !== grossAmount) {
    throw new Error(`Tổng phân bổ nguồn tiền (${sum}) phải bằng đúng tổng chi phí (${grossAmount}).`);
  }
  return allocations;
}

export function validateActualCostDecision(input: {
  action: ActualCostDecisionAction;
  actorId: string;
  activeDdIds: string[];
  expectedVersion: number;
  currentVersion: number;
  reason: string;
}) {
  if (input.activeDdIds.length !== 1) throw new Error("Công ty phải có duy nhất một AC_DD đang hoạt động.");
  if (input.activeDdIds[0] !== input.actorId) throw new Error("Chỉ người giữ vai trò AC_DD đang hoạt động được quyết định AC.");
  if (input.expectedVersion !== input.currentVersion) throw new Error("phiên bản đã thay đổi. Tải lại trước khi quyết định.");
  const reason = input.reason.trim();
  if (input.action === "RETURNED" && !reason) throw new Error("Cần nhập lý do trả lại AC.");
  return { action: input.action, reason };
}

export function nextActualCostVersion(currentVersion: number, currentState: string) {
  if (currentState !== "RETURNED") throw new Error("Chỉ AC ở trạng thái RETURNED mới được tạo phiên bản tiếp theo.");
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) throw new Error("Phiên bản AC không hợp lệ.");
  return currentVersion + 1;
}
