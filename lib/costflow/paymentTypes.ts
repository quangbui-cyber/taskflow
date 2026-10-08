export type PaymentKind = "ADVANCE" | "VENDOR_PAYMENT" | "REIMBURSEMENT";
export type PaymentDirection = "OUT" | "IN";
export type PaymentChannel = "BANK_TRANSFER" | "CASH" | "OTHER" | "LEGACY";
export type PaymentRecipientType = "EMPLOYEE" | "VENDOR";

export type PaymentIcSourceInput = {
  projectId: string;
  revisionId: string;
  lineId: string;
  budgetGross: string;
};

export type PaymentRecipientInput = {
  projectId: string;
  key: string;
  type: PaymentRecipientType;
  name: string;
  bankName?: string;
  accountLast4?: string;
  sourceVersion?: number;
};

export type PaymentDraftLineInput = {
  stableKey: string;
  description: string;
  amount: string;
  source: PaymentIcSourceInput;
  recipient: PaymentRecipientInput;
  evidenceIds?: string[];
};

export type PaymentDraftInput = {
  projectId: string;
  kind: PaymentKind;
  budgetEffectStatus?: "EFFECTIVE" | "NOT_EFFECTIVE";
  legacyEffective?: boolean;
  milestone: string;
  explanation?: string;
  clientTotal?: string;
  lines: PaymentDraftLineInput[];
};

export type PaymentWarning = {
  code: "OVER_REFERENCE";
  sourceKey: string;
  referencedAmount: string;
  requestedAmount: string;
  message: string;
};

export type NormalizedPaymentLine = Omit<PaymentDraftLineInput, "amount" | "description" | "evidenceIds"> & {
  position: number;
  description: string;
  amount: string;
  evidenceIds: string[];
};

export type PaymentDossierProjection = {
  projectId: string;
  kind: PaymentKind;
  milestone: string;
  explanation: string;
  lines: NormalizedPaymentLine[];
  totalAmount: string;
  recipientTotals: Record<string, string>;
  warnings: PaymentWarning[];
  canSubmit: true;
};

export type PaymentCashCommand = {
  projectId: string;
  requestId: string;
  recipientKey: string;
  direction: PaymentDirection;
  channel: PaymentChannel;
  amount: string;
  reference: string;
  idempotencyKey: string;
  commandFingerprint: string;
  occurredAt: string;
  evidenceId: string;
  allocations: { requestLineId: string; amount: string }[];
};

export type PaymentReadProjection = {
  requestId: string;
  projectId: string | null;
  kind: string;
  milestone: string | null;
  totalAmount: string | null;
  recipientTotals: Record<string, string>;
  provenance: "normalized" | "legacy";
  needsReview: boolean;
};

