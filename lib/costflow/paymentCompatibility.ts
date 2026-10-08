import type { PaymentReadProjection } from "./paymentTypes";

export type NormalizedPaymentRecord = {
  requestId: string;
  projectId: string;
  kind: string;
  milestone: string;
  totalAmount: string;
  recipientTotals: Record<string, string>;
};

export type LegacyPaymentRecord = {
  id: string;
  projectId: string | null;
  kind: string;
  payload: unknown;
};

function legacyProjection(record: LegacyPaymentRecord): PaymentReadProjection {
  const payload = record.payload && typeof record.payload === "object"
    ? record.payload as Record<string, unknown>
    : {};
  const amount = typeof payload.amount === "string" ? payload.amount : null;
  const recipientKey = typeof payload.recipientKey === "string" ? payload.recipientKey : null;
  return {
    requestId: record.id,
    projectId: record.projectId,
    kind: record.kind,
    milestone: typeof payload.milestone === "string" ? payload.milestone : null,
    totalAmount: amount,
    recipientTotals: amount && recipientKey ? { [recipientKey]: amount } : {},
    provenance: "legacy",
    needsReview: true,
  };
}

export function projectPaymentDossiers(
  normalized: NormalizedPaymentRecord[],
  legacy: LegacyPaymentRecord[],
): PaymentReadProjection[] {
  const normalizedIds = new Set(normalized.map(record => record.requestId));
  return [
    ...normalized.map(record => ({ ...record, provenance: "normalized" as const, needsReview: false })),
    ...legacy.filter(record => !normalizedIds.has(record.id)).map(legacyProjection),
  ];
}

