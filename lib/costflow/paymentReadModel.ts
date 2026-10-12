import { projectPaymentDossiers, type LegacyPaymentRecord } from "./paymentCompatibility";
import {
  settlementObligationProgress,
  type SettlementCashAllocationSource,
  type SettlementObligationCashSource,
} from "./settlementCash";

export type PaymentProgress = "CHUA_CHI" | "DANG_CHI_MOT_PHAN" | "DA_CHI_DU";

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
  provenance: "normalized" | "legacy" | "settlement";
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
  additionalOutBalance: string | null;
  refundInBalance: string | null;
  financialCloseState: FinancialCloseState;
  evidenceLinks: { id: string; label: string }[];
  dossierId?: string;
  dossierVersionId?: string;
  obligationId?: string;
};

type Input = {
  normalized: PaymentLedgerNormalizedRecord[];
  legacy: (LegacyPaymentRecord & { title?: string; state?: string })[];
  cash: PaymentLedgerCashRecord[];
  financialCloseState: FinancialCloseState;
  settlement?: {
    obligations: SettlementObligationCashSource[];
    allocations: SettlementCashAllocationSource[];
  };
};

function exactNonNegative(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("Số tiền read model phải là số nguyên VND không âm.");
  return BigInt(value);
}

function sum(values: string[]) {
  return values.reduce((total, value) => total + exactNonNegative(value), BigInt(0));
}

function derivePaymentProgress(approvedAmount: string, paidOutAmount: string) {
  return settlementObligationProgress(approvedAmount, paidOutAmount);
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

  const ordinaryRows = compatibility.flatMap(projected => {
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
        cashProgress: progress.cashProgress,
        approvedAcSourceStatus: "UNAVAILABLE" as const,
        additionalOutBalance: null,
        refundInBalance: null,
        financialCloseState: input.financialCloseState,
        evidenceLinks: evidenceIds.map(id => ({ id, label: "Chứng từ giao dịch" })),
      };
    });
  });
  const settlementRows = projectSettlementPendingDisbursements(input.settlement ?? { obligations: [], allocations: [] });
  return [...ordinaryRows, ...settlementRows.map(row => ({
    projectId: row.projectId,
    requestId: row.requestId,
    kind: "SETTLEMENT_ADDITIONAL_OUT",
    title: "Giải ngân bổ sung theo hồ sơ quyết toán",
    milestone: null,
    recipientKey: row.recipientKey,
    recipientLabel: row.recipientLabel,
    recipientType: row.recipientType,
    provenance: "settlement" as const,
    needsReview: false,
    approvalState: "APPROVED",
    beneficiaryVerification: row.recipientType === "VENDOR" ? "VERIFIED" as const : "NOT_APPLICABLE" as const,
    approvedAmount: row.approvedAmount,
    grossStandardOut: null,
    grossAdditionalOut: row.cumulativePaid,
    grossRefundedIn: "0",
    netCash: row.cumulativePaid,
    remainingStandardOut: row.remainingAmount,
    cashProgress: row.cashProgress,
    approvedAcSourceStatus: "UNAVAILABLE" as const,
    additionalOutBalance: row.remainingAmount,
    refundInBalance: null,
    financialCloseState: input.financialCloseState,
    evidenceLinks: [],
    dossierId: row.dossierId,
    dossierVersionId: row.dossierVersionId,
    obligationId: row.obligationId,
  }))];
}

export type SettlementPendingDisbursementRow = {
  projectId: string;
  requestId: string;
  dossierId: string;
  dossierVersionId: string;
  obligationId: string;
  recipientKey: string;
  recipientType: string;
  recipientLabel: string;
  direction: "OUT";
  approvedAmount: string;
  cumulativePaid: string;
  remainingAmount: string;
  cashProgress: PaymentProgress;
  sourceKind: "SETTLEMENT";
};

export type SettlementObligationProgressRow = {
  projectId: string;
  dossierVersionId: string;
  obligationId: string;
  recipientKey: string;
  direction: "IN" | "OUT";
  approvedAmount: string;
  cumulativeAmount: string;
  remainingAmount: string;
  cashProgress: PaymentProgress;
};

export type SettlementCorrectionProgressRow = SettlementObligationProgressRow & {
  correctionAttemptId: string;
  recoveryRemaining: string;
  availability: "RECOVERY_IN" | "BLOCKED_RECOVERY" | "READY" | "COMPLETE";
};

export function projectSettlementCorrectionProgress(input: {
  obligations: SettlementObligationCashSource[];
  allocations: SettlementCashAllocationSource[];
  pairs: Array<{
    projectId: string;
    correctionAttemptId: string;
    recoveryObligationId: string;
    correctedPaymentObligationId: string;
  }>;
}): SettlementCorrectionProgressRow[] {
  const progress = projectSettlementObligationProgress(input);
  const progressById = new Map(progress.map(row => [row.obligationId, row]));
  return input.pairs.flatMap(pair => {
    const recovery = progressById.get(pair.recoveryObligationId);
    const payment = progressById.get(pair.correctedPaymentObligationId);
    if (!recovery || !payment || recovery.projectId !== pair.projectId || payment.projectId !== pair.projectId) return [];
    const recoveryRemaining = recovery.remainingAmount;
    return [
      {
        ...recovery,
        correctionAttemptId: pair.correctionAttemptId,
        recoveryRemaining,
        availability: recovery.remainingAmount === "0" ? "COMPLETE" as const : "RECOVERY_IN" as const,
      },
      {
        ...payment,
        correctionAttemptId: pair.correctionAttemptId,
        recoveryRemaining,
        availability: payment.remainingAmount === "0"
          ? "COMPLETE" as const
          : recoveryRemaining === "0" ? "READY" as const : "BLOCKED_RECOVERY" as const,
      },
    ];
  });
}

export function projectSettlementObligationProgress(input: {
  obligations: SettlementObligationCashSource[];
  allocations: SettlementCashAllocationSource[];
}): SettlementObligationProgressRow[] {
  return input.obligations.flatMap(obligation => {
    if (obligation.sourceKind !== "SETTLEMENT" || !obligation.locked) return [];
    const cumulative = input.allocations
      .filter(allocation => allocation.projectId === obligation.projectId
        && allocation.dossierVersionId === obligation.dossierVersionId
        && allocation.obligationId === obligation.obligationId
        && allocation.recipientKey === obligation.recipientKey
        && allocation.direction === obligation.direction)
      .reduce((total, allocation) => total + BigInt(allocation.amount), BigInt(0));
    const progress = settlementObligationProgress(obligation.amountDue, cumulative.toString());
    return [{
      projectId: obligation.projectId,
      dossierVersionId: obligation.dossierVersionId,
      obligationId: obligation.obligationId,
      recipientKey: obligation.recipientKey,
      direction: obligation.direction,
      approvedAmount: progress.approvedAmount,
      cumulativeAmount: progress.cumulativePaid,
      remainingAmount: progress.remainingAmount,
      cashProgress: progress.cashProgress,
    }];
  });
}

export function projectSettlementPendingDisbursements(input: {
  obligations: SettlementObligationCashSource[];
  allocations: SettlementCashAllocationSource[];
}): SettlementPendingDisbursementRow[] {
  const obligationById = new Map(input.obligations.map(obligation => [obligation.obligationId, obligation]));
  return projectSettlementObligationProgress(input).flatMap(progress => {
    if (progress.direction !== "OUT" || progress.remainingAmount === "0") return [];
    const obligation = obligationById.get(progress.obligationId);
    if (!obligation) return [];
    return [{
      projectId: obligation.projectId,
      requestId: obligation.requestId,
      dossierId: obligation.dossierId,
      dossierVersionId: obligation.dossierVersionId,
      obligationId: obligation.obligationId,
      recipientKey: obligation.recipientKey,
      recipientType: obligation.recipientType,
      recipientLabel: obligation.recipientName,
      direction: "OUT" as const,
      approvedAmount: progress.approvedAmount,
      cumulativePaid: progress.cumulativeAmount,
      remainingAmount: progress.remainingAmount,
      cashProgress: progress.cashProgress,
      sourceKind: "SETTLEMENT" as const,
    }];
  });
}
