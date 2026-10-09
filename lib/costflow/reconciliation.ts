import { compare, decimal, exact, round, source, subtract, sum, totals } from "./money";
import type { CashRow, FinanceData } from "./types";
import { currentPurchaseOrders } from "./budgetSources";

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
