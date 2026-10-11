import { compare, decimal, exact, round, source, subtract, sum, totals } from "./money";
import type { CashRow, FinanceData } from "./types";
import { currentPurchaseOrders } from "./budgetSources";

export type FinancialCloseState = "OPEN" | "CLOSED";
export type FinancialCloseKind = "CLOSE" | "REOPEN";
export type FinancialCloseDecision = "REQUESTED" | "APPROVE" | "RETURN" | "REJECT";

export type FinancialCloseEventRecord = {
  decision: FinancialCloseDecision;
  actorId: string;
  reason: string;
  expectedVersion: number;
  createdAt: string;
};

export type FinancialCloseRequestRecord = {
  projectId: string;
  dossierId: string;
  kind: FinancialCloseKind;
  reason: string;
  requesterId: string;
  requesterRole: string;
  expectedVersion: number;
  events: FinancialCloseEventRecord[];
};

export type TwoWayCloseInput = {
  dossier: { id: string; versionId: string; state: string; sourceCount: number; lockCount: number } | null;
  obligations: Array<{ recipientKey: string; amountDue: string; allocatedAmount: string; everyCashHasEvidence: boolean }>;
  customerAccounting: {
    currentLiquidation: { id: string; documentNumber: string; signedAt: string; evidence: { id: string } | null } | null;
    receivable: { outstandingGross: string };
  };
};

export function twoWayCloseBlockers(input: TwoWayCloseInput) {
  const blockers: string[] = [];
  if (!input.dossier || input.dossier.state !== "APPROVED") {
    blockers.push("Hồ sơ quyết toán cuối cùng chưa được CEO phê duyệt.");
  } else if (input.dossier.sourceCount === 0 || input.dossier.lockCount !== input.dossier.sourceCount) {
    blockers.push("Nguồn AC/tạm ứng của hồ sơ quyết toán chưa có đủ khóa SETTLED bất biến.");
  }
  if (input.obligations.some(item => compare(decimal(item.amountDue), decimal(item.allocatedAmount)) !== 0)) {
    blockers.push("Còn công nợ nội bộ chưa thực hiện đủ (balance != 0).");
  }
  if (input.obligations.some(item => !item.everyCashHasEvidence)) {
    blockers.push("Còn giao dịch tiền nội bộ thiếu chứng từ.");
  }
  const liquidation = input.customerAccounting.currentLiquidation;
  if (!liquidation?.documentNumber || !liquidation.signedAt || !liquidation.evidence?.id) {
    blockers.push("Dự án chưa có Biên bản thanh lý khách hàng đã ký và chứng từ đính kèm.");
  }
  if (compare(decimal(input.customerAccounting.receivable.outstandingGross), decimal("0")) !== 0) {
    blockers.push("Customer AR chưa về đúng 0; khách hàng chưa thanh toán đủ 100% tiền thanh lý.");
  }
  return blockers;
}

export function closeProjectRequest(input: {
  projectId: string;
  dossierId: string;
  kind: FinancialCloseKind;
  reason: string;
  requester: { id: string; role: string; isProjectMember: boolean; isProjectOwner: boolean };
  expectedVersion: number;
  financialCloseState: FinancialCloseState;
  now?: string;
}): FinancialCloseRequestRecord {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Thiếu lý do đóng/mở tài chính.");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new Error("Phiên bản CostFlow không hợp lệ.");
  const eligibleRole = input.requester.role === "USER" || input.requester.role === "ACCOUNT";
  if (!eligibleRole || (!input.requester.isProjectMember && !input.requester.isProjectOwner)) {
    throw new Error("Chỉ Nhân sự thuộc Project hoặc Account/Project Owner được yêu cầu đóng/mở tài chính.");
  }
  if (input.kind === "CLOSE" && input.financialCloseState !== "OPEN") throw new Error("Tài chính Project đã đóng.");
  if (input.kind === "REOPEN" && input.financialCloseState !== "CLOSED") throw new Error("Tài chính Project chưa đóng.");
  const requested: FinancialCloseEventRecord = {
    decision: "REQUESTED",
    actorId: input.requester.id,
    reason,
    expectedVersion: input.expectedVersion,
    createdAt: input.now ?? new Date().toISOString(),
  };
  return {
    projectId: input.projectId,
    dossierId: input.dossierId,
    kind: input.kind,
    reason,
    requesterId: input.requester.id,
    requesterRole: input.requester.role,
    expectedVersion: input.expectedVersion,
    events: [requested],
  };
}

export function decideFinancialClose(request: FinancialCloseRequestRecord, input: {
  actorId: string;
  assignedManagerId: string;
  decision: Exclude<FinancialCloseDecision, "REQUESTED">;
  reason: string;
  currentVersion: number;
  currentCloseState: FinancialCloseState;
  blockers: string[];
  now?: string;
}) {
  if (!input.assignedManagerId || input.actorId !== input.assignedManagerId) throw new Error("Chỉ Quản lý được phân công của Project được quyết định.");
  if (request.events.some(event => event.decision !== "REQUESTED")) throw new Error("Yêu cầu đóng/mở đã có quyết định bất biến.");
  if (input.currentVersion < request.expectedVersion) throw new Error("Phiên bản quyết định cũ hơn yêu cầu đóng/mở tài chính.");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Thiếu lý do quyết định đóng/mở tài chính.");
  if (input.decision === "APPROVE") {
    if (request.kind === "CLOSE" && input.currentCloseState !== "OPEN") throw new Error("Tài chính Project không còn ở trạng thái mở.");
    if (request.kind === "REOPEN" && input.currentCloseState !== "CLOSED") throw new Error("Tài chính Project không còn ở trạng thái đóng.");
    if (request.kind === "CLOSE" && input.blockers.length) throw new Error(input.blockers.join(" "));
  }
  const event: FinancialCloseEventRecord = { decision: input.decision, actorId: input.actorId, reason, expectedVersion: input.currentVersion, createdAt: input.now ?? new Date().toISOString() };
  return {
    ...request,
    events: [...request.events, event],
    financialCloseState: input.decision !== "APPROVE"
      ? input.currentCloseState
      : request.kind === "CLOSE" ? "CLOSED" as const : "OPEN" as const,
  };
}

export function reconcile(data: FinanceData, cash: CashRow[]) {
  const keys = new Set([...data.expenses.map(e => e.recipientKey), ...cash.map(c => c.recipientKey)]);
  return [...keys].map(recipientKey => {
    const costs = totals(data.expenses.filter(e => e.recipientKey === recipientKey).map(e => e.cost));
    const paid = sum(cash.filter(c => c.recipientKey === recipientKey && c.direction === "OUT").map(c => decimal(c.amount)));
    const refunded = sum(cash.filter(c => c.recipientKey === recipientKey && c.direction === "IN").map(c => decimal(c.amount)));
    // The monetary obligation uses the confirmed rounded total, not a hidden fractional debt.
    // Original raw values still determine that total and remain available for source comparison.
    const balance = subtract(decimal(costs.gross), subtract(paid, refunded));
    return { recipientKey, actualGross: costs.gross, paid: round(paid), refunded: round(refunded), balance: round(balance), rawBalance: source(balance), payable: compare(balance, decimal("0")) > 0, receivable: compare(balance, decimal("0")) < 0 };
  });
}

export function isExpenseApproved(e: { invoiceId?: string | null; paymentProofId?: string | null; exceptionStatus?: string | null }) {
  return Boolean((e.invoiceId && e.paymentProofId) || e.exceptionStatus === "APPROVED");
}

export function closeBlockers(data: FinanceData, cash: CashRow[]) {
  const blockers: string[] = [];
  if (reconcile(data, cash).some(row => compare(exact(row.rawBalance), decimal("0")) !== 0)) blockers.push("Còn khoản phải trả hoặc thu hoàn.");
  if (data.expenses.some(e => !isExpenseApproved(e))) blockers.push("Chi phí chưa đủ chứng từ và bằng chứng đã chi.");
  if (cash.some(c => !c.evidenceId)) blockers.push("Giao dịch tiền thiếu chứng từ.");
  return blockers;
}

export function settlement(data: FinanceData, cash: CashRow[], recipientKey: string, options?: { allowPendingAc?: boolean }) {
  const expenses = data.expenses.filter(e => e.recipientKey === recipientKey);
  const hasIncomplete = expenses.some(e => (!e.invoiceId || !e.paymentProofId) && e.exceptionStatus !== "APPROVED");
  if (!expenses.length) throw new Error("Chưa có khoản chi phí AC nào được ghi nhận cho đối tượng này.");
  if (!options?.allowPendingAc && hasIncomplete) throw new Error("Hoàn tạm ứng cần đủ IC/AC, chứng từ chi phí và bằng chứng đã chi.");
  const total = totals(expenses.map(e => e.cost));
  const paid = sum(cash.filter(c => c.recipientKey === recipientKey && c.direction === "OUT").map(c => decimal(c.amount)));
  const refunded = sum(cash.filter(c => c.recipientKey === recipientKey && c.direction === "IN").map(c => decimal(c.amount)));
  const difference = subtract(decimal(total.gross), subtract(paid, refunded));
  return { actualGross: total.gross, advance: round(paid), additional: compare(difference, decimal("0")) > 0 ? round(difference) : "0", refund: compare(difference, decimal("0")) < 0 ? round(subtract(decimal("0"), difference)) : "0", reconciliation: source(difference), expenseIds: expenses.map(e => e.id), isAcApproved: !hasIncomplete };
}

export function margin(data: FinanceData) {
  // Legacy budget-only compatibility. The CostFlow UI actual-margin authority is
  // deriveCustomerAccounting(): signed liquidation net -> quotation net -> PO net,
  // minus normalized AC net with explicit non-overlapping legacy fallback.
  const revenue = sum(currentPurchaseOrders(data.pos).map(po => decimal(po.net)));
  const incurred = totals(data.expenses.map(e => e.cost));
  return { revenue: round(revenue), incurred: incurred.net, margin: round(subtract(revenue, exact(incurred.rawNet))) };
}
