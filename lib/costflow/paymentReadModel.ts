import { projectPaymentDossiers, type LegacyPaymentRecord } from "./paymentCompatibility";
import { derivePaymentProgress, type PaymentProgress } from "./paymentCash";

export type BeneficiaryVerification = "VERIFIED" | "UNVERIFIED" | "NOT_APPLICABLE" | "UNKNOWN";
export type FinancialCloseState = "OPEN" | "CLOSED";

export type PaymentLedgerNormalizedRecord = {
  requestId: string;
  projectId: string;
  kind: string;
  title: string;
  milestone: string;
  approvalState: string;
  recipients: {
    recipientKey: string;
    recipientType: string;
    displayName: string;
    totalAmount: string;
    beneficiaryVerification: BeneficiaryVerification;
  }[];
  lines: { id: string; recipientKey: string; amount: string }[];
};

export type PaymentLedgerCashRecord = {
  id: string;
  projectId: string;
  requestId: string;
  recipientKey: string;
  direction: string;
  amount: string;
  evidenceId: string;
  normalizedAllocations: { requestLineId: string; amount: string; direction: string }[];
};

export type PaymentLedgerRow = {
  projectId: string | null;
  requestId: string;
  kind: string;
  title: string;
  milestone: string | null;
  recipientKey: string;
  recipientLabel: string;
  recipientType: string;
  provenance: "normalized" | "legacy";
  needsReview: boolean;
  approvalState: string;
  beneficiaryVerification: BeneficiaryVerification;
  approvedAmount: string | null;
  grossStandardOut: string | null;
  grossAdditionalOut: string | null;
  grossRefundedIn: string | null;
  netCash: string | null;
  remainingStandardOut: string | null;
  cashProgress: PaymentProgress | "UNKNOWN";
  approvedAcSourceStatus: "UNAVAILABLE";
  additionalOutBalance: null;
  refundInBalance: null;
  financialCloseState: FinancialCloseState;
  evidenceLinks: { id: string; label: string }[];
};

type Input = {
  normalized: PaymentLedgerNormalizedRecord[];
  legacy: (LegacyPaymentRecord & { title?: string; state?: string })[];
  cash: PaymentLedgerCashRecord[];
  financialCloseState: FinancialCloseState;
};

function exactNonNegative(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("Số tiền read model phải là số nguyên VND không âm.");
  return BigInt(value);
}

function sum(values: string[]) {
  return values.reduce((total, value) => total + exactNonNegative(value), BigInt(0));
}

export function projectPaymentLedger(input: Input): PaymentLedgerRow[] {
  const compatibility = projectPaymentDossiers(
    input.normalized.map(record => ({
      requestId: record.requestId,
      projectId: record.projectId,
      kind: record.kind,
      milestone: record.milestone,
      totalAmount: sum(record.recipients.map(recipient => recipient.totalAmount)).toString(),
      recipientTotals: Object.fromEntries(record.recipients.map(recipient => [recipient.recipientKey, recipient.totalAmount])),
    })),
    input.legacy,
  );
  const normalizedById = new Map(input.normalized.map(record => [record.requestId, record]));
  const legacyById = new Map(input.legacy.map(record => [record.id, record]));

  return compatibility.flatMap(projected => {
    const normalized = normalizedById.get(projected.requestId);
    if (!normalized) {
      const legacy = legacyById.get(projected.requestId);
      const recipients = Object.entries(projected.recipientTotals);
      const entries = recipients.length ? recipients : [["UNKNOWN", projected.totalAmount ?? "0"]] as [string, string][];
      return entries.map(([recipientKey, amount]): PaymentLedgerRow => ({
        projectId: projected.projectId,
        requestId: projected.requestId,
        kind: projected.kind,
        title: legacy?.title ?? "Hồ sơ legacy",
        milestone: projected.milestone,
        recipientKey,
        recipientLabel: "Cần kiểm tra nguồn cũ",
        recipientType: "UNKNOWN",
        provenance: "legacy",
        needsReview: true,
        approvalState: legacy?.state ?? "UNKNOWN",
        beneficiaryVerification: "UNKNOWN",
        approvedAmount: amount === "0" && !projected.totalAmount ? null : amount,
        grossStandardOut: null,
        grossAdditionalOut: null,
        grossRefundedIn: null,
        netCash: null,
        remainingStandardOut: null,
        cashProgress: "UNKNOWN",
        approvedAcSourceStatus: "UNAVAILABLE",
        additionalOutBalance: null,
        refundInBalance: null,
        financialCloseState: input.financialCloseState,
        evidenceLinks: [],
      }));
    }

    return normalized.recipients.map(recipient => {
      const lineIds = new Set(normalized.lines.filter(line => line.recipientKey === recipient.recipientKey).map(line => line.id));
      const relevantCash = input.cash.filter(cash => cash.projectId === normalized.projectId && cash.requestId === normalized.requestId && cash.recipientKey === recipient.recipientKey);
      const allocations = relevantCash.flatMap(cash => cash.normalizedAllocations
        .filter(allocation => lineIds.has(allocation.requestLineId) && allocation.direction === cash.direction)
        .map(allocation => ({ ...allocation, cash })));
      const standardOut = sum(allocations.filter(item => normalized.kind === "ADVANCE" && item.cash.direction === "OUT").map(item => item.amount));
      const additionalOut = sum(allocations.filter(item => normalized.kind !== "ADVANCE" && item.cash.direction === "OUT").map(item => item.amount));
      const refundedIn = sum(allocations.filter(item => item.cash.direction === "IN").map(item => item.amount));
      const progress = derivePaymentProgress(recipient.totalAmount, standardOut.toString());
      const evidenceIds = [...new Set(allocations.map(item => item.cash.evidenceId).filter(Boolean))];
      return {
        projectId: normalized.projectId,
        requestId: normalized.requestId,
        kind: normalized.kind,
        title: normalized.title,
        milestone: normalized.milestone,
        recipientKey: recipient.recipientKey,
        recipientLabel: recipient.displayName,
        recipientType: recipient.recipientType,
        provenance: "normalized" as const,
        needsReview: false,
        approvalState: normalized.approvalState,
        beneficiaryVerification: recipient.beneficiaryVerification,
        approvedAmount: recipient.totalAmount,
        grossStandardOut: standardOut.toString(),
        grossAdditionalOut: additionalOut.toString(),
        grossRefundedIn: refundedIn.toString(),
        netCash: (standardOut + additionalOut - refundedIn).toString(),
        remainingStandardOut: progress.remainingAmount,
        cashProgress: progress.progress,
        approvedAcSourceStatus: "UNAVAILABLE" as const,
        additionalOutBalance: null,
        refundInBalance: null,
        financialCloseState: input.financialCloseState,
        evidenceLinks: evidenceIds.map(id => ({ id, label: "Chứng từ giao dịch" })),
      };
    });
  });
}
