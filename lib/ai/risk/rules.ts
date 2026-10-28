import { compare, exact } from "@/lib/costflow/money";

export const AI_FINANCE_RULE_VERSION = "phase15-finance-v1";
export type FindingKind = "RULE_ERROR" | "AI_SUSPICION" | "MISSING_DATA";
export type FindingDraft = {
  kind: FindingKind;
  ruleCode: string;
  ruleVersion: string;
  targetKind: "FIELD" | "RUN" | "PAYMENT_LINE" | "AC_VERSION" | "INVOICE";
  targetId: string;
  sourceSpanId: string | null;
};
export type CandidateFact = {
  id: string; rowKey: string; fieldKey: string; aiValue: string | null;
  provenance: string; confidence: string | null; sourceSpanId: string | null;
};
export type InvoiceFact = {
  id: string; sellerTaxCode: string; symbol: string; invoiceNumber: string; issuedAt: string;
};
export type CashFact = {
  lineId: string; approvedAmount: string; paidAmount: string; requestState: string;
};
export type LineageFact = {
  id: string; lineId: string; versionId: string; currentVersionId: string | null;
  approvalVersionId: string | null; approvalAction: string | null;
};

function amount(value: string) {
  try { const parsed = exact(value); return parsed.numerator >= BigInt(0) ? parsed : null; }
  catch { return null; }
}
function text(value: string | null) { return value?.trim().toUpperCase() ?? ""; }

export function evaluateDeterministicFindings(input: {
  runId: string; candidates: readonly CandidateFact[]; invoices: readonly InvoiceFact[];
  cash: readonly CashFact[]; lineage: readonly LineageFact[];
  evidence: readonly { versionId: string; evidenceCount: number; approved: boolean }[];
  modelFlags?: readonly { candidateId: string; code: string }[];
}): FindingDraft[] {
  const result: FindingDraft[] = [];
  const byKey = new Map(input.candidates.map((field) => [field.fieldKey, field]));
  const invoiceFields = ["sellerTaxCode", "symbol", "invoiceNumber", "issuedAt"].map((key) => byKey.get(key));
  if (invoiceFields.every((field) => field?.aiValue)) {
    const [tax, symbol, number, issued] = invoiceFields.map((field) => text(field!.aiValue));
    if (input.invoices.some((invoice) => text(invoice.sellerTaxCode) === tax && text(invoice.symbol) === symbol &&
      text(invoice.invoiceNumber) === number && invoice.issuedAt.slice(0, 10) === issued)) {
      const field = byKey.get("invoiceNumber")!;
      result.push({ kind: "RULE_ERROR", ruleCode: "DUPLICATE_INVOICE", ruleVersion: AI_FINANCE_RULE_VERSION,
        targetKind: "FIELD", targetId: field.id, sourceSpanId: field.sourceSpanId });
    }
  }
  for (const item of input.cash) {
    const approved = amount(item.approvedAmount);
    const paid = amount(item.paidAmount);
    if (approved === null || paid === null) continue;
    if (compare(paid, exact("0")) > 0 && (item.requestState !== "APPROVED" || compare(paid, approved) > 0)) {
      result.push({ kind: "RULE_ERROR", ruleCode: "PAID_VS_APPROVED", ruleVersion: AI_FINANCE_RULE_VERSION,
        targetKind: "PAYMENT_LINE", targetId: item.lineId, sourceSpanId: null });
    }
  }
  for (const item of input.lineage) {
    if (!item.currentVersionId || item.versionId !== item.currentVersionId ||
      item.approvalVersionId !== item.versionId || item.approvalAction !== "APPROVED") {
      result.push({ kind: "RULE_ERROR", ruleCode: "AC_LINEAGE", ruleVersion: AI_FINANCE_RULE_VERSION,
        targetKind: "AC_VERSION", targetId: item.id, sourceSpanId: null });
    }
  }
  for (const item of input.evidence) {
    if (item.approved && item.evidenceCount === 0) {
      result.push({ kind: "MISSING_DATA", ruleCode: "MISSING_EVIDENCE", ruleVersion: AI_FINANCE_RULE_VERSION,
        targetKind: "AC_VERSION", targetId: item.versionId, sourceSpanId: null });
    }
  }
  for (const field of input.candidates) {
    if (field.aiValue === null) result.push({ kind: "MISSING_DATA", ruleCode: "UNREADABLE_FIELD",
      ruleVersion: AI_FINANCE_RULE_VERSION, targetKind: "FIELD", targetId: field.id, sourceSpanId: field.sourceSpanId });
  }
  for (const flag of input.modelFlags ?? []) {
    const field = input.candidates.find((candidate) => candidate.id === flag.candidateId);
    if (!field || !/^[A-Z0-9_]{1,64}$/.test(flag.code)) continue;
    result.push({ kind: "AI_SUSPICION", ruleCode: flag.code, ruleVersion: AI_FINANCE_RULE_VERSION,
      targetKind: "FIELD", targetId: field.id, sourceSpanId: field.sourceSpanId });
  }
  return result;
}
