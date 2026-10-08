import type { ApprovedActualCostLine } from "./approvedActualCost";

export type AdvanceSourceSelection = {
  projectId: string;
  recipientKey: string;
  advanceRequestId: string;
  advanceLineId: string;
  grossOutAmount: string;
  alreadyAppliedAmount: string;
  selectedAmount: string;
};

const vnd = (value: string, allowZero = false) => {
  if (!(allowZero ? /^\d+$/ : /^[1-9]\d*$/.test(value))) throw new Error("Số tiền settlement phải là số nguyên VND hợp lệ.");
  return BigInt(value);
};

export function calculateSelectedAdvanceSettlement(input: {
  projectId: string;
  recipientKey: string;
  approvedActualLines: ApprovedActualCostLine[];
  selectedAdvances: AdvanceSourceSelection[];
  committedSettlementIn?: string;
  committedApprovedAdditionalOut?: string;
}) {
  if (!input.approvedActualLines.length) throw new Error("Cần AC đã duyệt để đối soát tạm ứng.");
  if (!input.selectedAdvances.length) throw new Error("Account phải chọn rõ nguồn tạm ứng; hệ thống không áp dụng FIFO.");
  if (new Set(input.selectedAdvances.map(source => source.advanceLineId)).size !== input.selectedAdvances.length) throw new Error("Nguồn tạm ứng bị chọn trùng hoặc đã tái sử dụng.");
  for (const line of input.approvedActualLines) {
    if (line.projectId !== input.projectId) throw new Error("Không được dùng dòng AC chéo Project.");
    if (line.recipientKey !== input.recipientKey) throw new Error("Không được dùng dòng AC chéo người nhận.");
  }
  for (const source of input.selectedAdvances) {
    if (source.projectId !== input.projectId) throw new Error("Không được chọn nguồn tạm ứng chéo Project.");
    if (source.recipientKey !== input.recipientKey) throw new Error("Không được chọn nguồn tạm ứng chéo người nhận.");
    const remaining = vnd(source.grossOutAmount) - vnd(source.alreadyAppliedAmount, true);
    const selected = vnd(source.selectedAmount);
    if (remaining < BigInt(0) || selected > remaining) throw new Error("Nguồn tạm ứng đã được dùng hoặc vượt số còn lại.");
  }
  const actualUsed = input.approvedActualLines.reduce((total, line) => total + vnd(line.approvedAmount), BigInt(0));
  const advanceApplied = input.selectedAdvances.reduce((total, source) => total + vnd(source.selectedAmount), BigInt(0));
  const committedIn = vnd(input.committedSettlementIn ?? "0", true);
  const committedAdditionalOut = vnd(input.committedApprovedAdditionalOut ?? "0", true);
  const refund = advanceApplied - actualUsed - committedIn;
  const additional = actualUsed - advanceApplied - committedAdditionalOut;
  return {
    selectedAdvanceLineIds: input.selectedAdvances.map(source => source.advanceLineId),
    actualUsed: actualUsed.toString(),
    advanceApplied: advanceApplied.toString(),
    unusedOrRefundDue: (refund > BigInt(0) ? refund : BigInt(0)).toString(),
    overspendOrAdditionalDue: (additional > BigInt(0) ? additional : BigInt(0)).toString(),
  };
}

export function authorizeSettlementCash(input: { direction: "IN" | "OUT"; amount: string; refundDue: string; additionalDue: string; ordinaryApproved: boolean }) {
  const amount = vnd(input.amount);
  if (input.direction === "IN") {
    if (amount > vnd(input.refundDue, true)) throw new Error("Thu hoàn vượt số phải hoàn.");
    return { authorized: true as const, kind: "REFUND_IN" as const };
  }
  if (!input.ordinaryApproved) throw new Error("Khoản chi thêm phải đi qua duyệt thông thường.");
  if (amount > vnd(input.additionalDue, true)) throw new Error("Chi thêm vượt số được duyệt còn lại.");
  return { authorized: true as const, kind: "ADDITIONAL_OUT" as const };
}
