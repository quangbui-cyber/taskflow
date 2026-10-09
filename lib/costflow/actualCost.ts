import { compare, decimal, multiply, round, source } from "./money";
import type { ActualCostFundingSource, Expense } from "./types";

export const ACTUAL_COST_FUNDING_SOURCES = [
  "EMPLOYEE_ADVANCE",
  "EMPLOYEE_OUT_OF_POCKET",
  "VENDOR_ADVANCE",
  "VENDOR_PAYMENT",
] as const satisfies readonly ActualCostFundingSource[];

export type ActualCostDecisionAction = "APPROVED" | "RETURNED";

export function calculateActualCost(input: { quantity: string; days: string; unitPrice: string }) {
  const quantity = decimal(input.quantity);
  const days = decimal(input.days);
  const unitPrice = decimal(input.unitPrice);
  const zero = decimal("0");
  if (compare(quantity, zero) <= 0 || compare(days, zero) <= 0 || compare(unitPrice, zero) < 0) {
    throw new Error("Số lượng và số ngày phải lớn hơn 0; đơn giá không được âm.");
  }
  const raw = multiply(multiply(quantity, days), unitPrice);
  return { amount: round(raw), rawAmount: source(raw) };
}

export function normalizeActualCostFundingSource(value: string): ActualCostFundingSource {
  if (!ACTUAL_COST_FUNDING_SOURCES.includes(value as ActualCostFundingSource)) {
    throw new Error("Chọn đúng nguồn thanh toán AC.");
  }
  return value as ActualCostFundingSource;
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

export type LegacyActualCostRow = {
  id: string;
  source: "legacy";
  reviewState: "needsReview";
  approvalState: null;
  description: string;
  recipientKey: string;
  amount: string;
  revisionId: string;
  icLineId: string;
};

export function normalizeLegacyActualCosts(expenses: Expense[]): LegacyActualCostRow[] {
  return expenses.map(expense => ({
    id: expense.id,
    source: "legacy",
    reviewState: "needsReview",
    approvalState: null,
    description: expense.description,
    recipientKey: expense.recipientKey,
    amount: expense.cost.gross,
    revisionId: expense.revisionId,
    icLineId: expense.lineId,
  }));
}
