import { compare, decimal, round, sum, type CalculatedCost } from "./money";

export type ActualCostLens = "COST_TYPES" | "SELF" | "VENDORS" | "AUDIT";

export type ActualCostControlCapabilities = {
  account: boolean;
  self: boolean;
  vendorOperations: boolean;
  audit: boolean;
  canDecide: boolean;
  canConfigureOperations: boolean;
  lenses: ActualCostLens[];
};

export type ControlCenterOccurrence = {
  id: string;
  stableLineId: string;
  sourceKind: "IC_LINKED" | "UNBUDGETED" | "LEGACY";
  description: string;
  recipientKey: string;
  fundingSource: string | null;
  quantity: string | null;
  days: string | null;
  unitPrice: string | null;
  unit: string | null;
  cost: CalculatedCost | null;
  reviewState: string;
  missingEvidenceWarnings: string[];
  evidenceKinds: string[];
  lockedByApplications: boolean;
  applicationRequestIds: string[];
};

export type ControlCenterComparison = {
  key: string;
  sourceKind: "IC_LINKED" | "UNBUDGETED";
  description: string;
  unit: string;
  ic: { quantity: string; days: string; unitPrice: string; cost: CalculatedCost } | null;
  actualLineIds: string[];
  actual: CalculatedCost;
  variance: CalculatedCost;
  status: "OVER_BUDGET" | "SAVING" | "ON_BUDGET";
};

export type ControlCenterPayment = {
  requestId: string;
  kind: string;
  title: string;
  recipientKey: string;
  recipientLabel: string;
  approvalState: string;
  approvedAmount: string | null;
  grossStandardOut: string | null;
  grossAdditionalOut: string | null;
  grossRefundedIn: string | null;
  netCash: string | null;
  remainingStandardOut: string | null;
  cashProgress: string;
};

export type ControlCenterMilestone = {
  id: string;
  vendorId: string;
  title: string;
  amount: string;
  dueDate: string;
  linkedRequestId?: string;
};

export type ActualCostControlCenter = {
  capabilities: ActualCostControlCapabilities;
  defaultLens: ActualCostLens;
  worksheet: {
    groups: (ControlCenterComparison & { occurrences: ControlCenterOccurrence[] })[];
    unbudgeted: ControlCenterOccurrence[];
    totals: { ic: CalculatedCost; actual: CalculatedCost; variance: CalculatedCost };
  };
  staff: {
    recipientKey: string;
    recipientLabel: string;
    advancePaid: string;
    advanceFundedActual: string;
    outOfPocket: string;
    reimbursed: string;
    refundReceived: string;
    remainingDue: string;
    refundDue: string;
    occurrenceIds: string[];
  }[];
  vendors: {
    recipientKey: string;
    recipientLabel: string;
    actual: string;
    requested: string;
    paid: string;
    outstanding: string;
    progress: string;
    milestones: ControlCenterMilestone[];
    requestStates: { requestId: string; title: string; approvalState: string; cashProgress: string }[];
    occurrenceIds: string[];
  }[];
  audit: {
    code: "UNBUDGETED" | "OVER_IC" | "MISSING_EVIDENCE" | "UNAPPROVED" | "LOCKED" | "UNMATCHED_PAYMENT" | "OVERDUE_MILESTONE";
    severity: "info" | "warning" | "danger";
    label: string;
    occurrenceId?: string;
    requestId?: string;
    milestoneId?: string;
  }[];
};

const zeroCost = (): CalculatedCost => ({ rawNet: "0/1", rawVat: "0/1", rawGross: "0/1", net: "0", vat: "0", gross: "0" });
const vnd = (value: string | null | undefined) => (/^-?\d+$/.test(value ?? "") ? BigInt(value!) : BigInt(0));
const totalCosts = (values: CalculatedCost[]) => values.length ? {
  rawNet: "0/1",
  rawVat: "0/1",
  rawGross: "0/1",
  net: round(sum(values.map(value => decimal(value.net)))),
  vat: round(sum(values.map(value => decimal(value.vat)))),
  gross: round(sum(values.map(value => decimal(value.gross)))),
} : zeroCost();
const subtractCosts = (left: CalculatedCost, right: CalculatedCost): CalculatedCost => ({
  rawNet: "0/1",
  rawVat: "0/1",
  rawGross: "0/1",
  net: (vnd(left.net) - vnd(right.net)).toString(),
  vat: (vnd(left.vat) - vnd(right.vat)).toString(),
  gross: (vnd(left.gross) - vnd(right.gross)).toString(),
});

export function resolveActualCostCapabilities(input: {
  actorId: string;
  actorRole: string;
  isProjectMember: boolean;
  isDd: boolean;
  accountantId: string;
  operationUserIds: string[];
}): ActualCostControlCapabilities {
  const account = input.actorRole === "ADMIN" || (input.actorRole === "ACCOUNT" && input.isProjectMember);
  const vendorOperations = input.isProjectMember && input.operationUserIds.includes(input.actorId);
  const audit = input.isDd || input.actorId === input.accountantId || input.actorRole === "ADMIN";
  const self = input.isProjectMember;
  const lenses: ActualCostLens[] = [];
  if (account || audit) lenses.push("COST_TYPES");
  if (self) lenses.push("SELF");
  if (account || vendorOperations) lenses.push("VENDORS");
  if (audit) lenses.push("AUDIT");
  return {
    account,
    self,
    vendorOperations,
    audit,
    canDecide: input.isDd,
    canConfigureOperations: input.actorRole === "ADMIN",
    lenses,
  };
}

export function buildActualCostControlCenter(input: {
  actorId: string;
  capabilities: ActualCostControlCapabilities;
  occurrences: ControlCenterOccurrence[];
  comparisons: ControlCenterComparison[];
  payments: ControlCenterPayment[];
  milestones: ControlCenterMilestone[];
  recipientNames: Record<string, string>;
  now?: Date;
}): ActualCostControlCenter {
  const ownKey = `USER:${input.actorId}`;
  const allowedOccurrences = input.capabilities.account || input.capabilities.audit
    ? input.occurrences
    : input.capabilities.vendorOperations
      ? input.occurrences.filter(item => item.recipientKey.startsWith("VENDOR:"))
      : input.occurrences.filter(item => item.recipientKey === ownKey);
  const allowedIds = new Set(allowedOccurrences.map(item => item.id));
  const comparisons = input.comparisons
    .map(item => {
      const actualLineIds = item.actualLineIds.filter(id => allowedIds.has(id));
      const actual = totalCosts(allowedOccurrences.filter(line => actualLineIds.includes(line.id)).flatMap(line => line.cost ? [line.cost] : []));
      const variance = subtractCosts(actual, item.ic?.cost ?? zeroCost());
      const relation = compare(decimal(actual.gross), decimal(item.ic?.cost.gross ?? "0"));
      return { ...item, actualLineIds, actual, variance, status: relation > 0 ? "OVER_BUDGET" as const : relation < 0 ? "SAVING" as const : "ON_BUDGET" as const };
    })
    .filter(item => item.actualLineIds.length > 0 || (input.capabilities.account || input.capabilities.audit));
  const groups = comparisons.map(item => ({ ...item, occurrences: allowedOccurrences.filter(line => item.actualLineIds.includes(line.id)) }));
  const allowedPayments = input.capabilities.account || input.capabilities.audit
    ? input.payments
    : input.capabilities.vendorOperations
      ? input.payments.filter(item => item.recipientKey.startsWith("VENDOR:"))
      : input.payments.filter(item => item.recipientKey === ownKey);
  const staffKeys = [...new Set(allowedOccurrences.filter(item => item.recipientKey.startsWith("USER:")).map(item => item.recipientKey))];
  const vendorKeys = [...new Set([
    ...allowedOccurrences.filter(item => item.recipientKey.startsWith("VENDOR:")).map(item => item.recipientKey),
    ...allowedPayments.filter(item => item.recipientKey.startsWith("VENDOR:")).map(item => item.recipientKey),
  ])];
  const staff = staffKeys.map(recipientKey => {
    const occurrences = allowedOccurrences.filter(item => item.recipientKey === recipientKey);
    const payments = allowedPayments.filter(item => item.recipientKey === recipientKey);
    const advancePaid = payments.filter(item => item.kind === "ADVANCE").reduce((total, item) => total + vnd(item.grossStandardOut), BigInt(0));
    const advanceFundedActual = occurrences.filter(item => item.fundingSource === "EMPLOYEE_ADVANCE").reduce((total, item) => total + vnd(item.cost?.gross), BigInt(0));
    const outOfPocket = occurrences.filter(item => item.fundingSource === "EMPLOYEE_OUT_OF_POCKET").reduce((total, item) => total + vnd(item.cost?.gross), BigInt(0));
    const reimbursed = payments.filter(item => item.kind === "REIMBURSEMENT").reduce((total, item) => total + vnd(item.grossAdditionalOut), BigInt(0));
    const refundReceived = payments.reduce((total, item) => total + vnd(item.grossRefundedIn), BigInt(0));
    return {
      recipientKey,
      recipientLabel: input.recipientNames[recipientKey] ?? "Nhân sự",
      advancePaid: advancePaid.toString(),
      advanceFundedActual: advanceFundedActual.toString(),
      outOfPocket: outOfPocket.toString(),
      reimbursed: reimbursed.toString(),
      refundReceived: refundReceived.toString(),
      remainingDue: (outOfPocket > reimbursed ? outOfPocket - reimbursed : BigInt(0)).toString(),
      refundDue: (advancePaid > advanceFundedActual + refundReceived ? advancePaid - advanceFundedActual - refundReceived : BigInt(0)).toString(),
      occurrenceIds: occurrences.map(item => item.id),
    };
  });
  const vendors = vendorKeys.map(recipientKey => {
    const occurrences = allowedOccurrences.filter(item => item.recipientKey === recipientKey);
    const payments = allowedPayments.filter(item => item.recipientKey === recipientKey);
    const actual = occurrences.reduce((total, item) => total + vnd(item.cost?.gross), BigInt(0));
    const requested = payments.reduce((total, item) => total + vnd(item.approvedAmount), BigInt(0));
    const paid = payments.reduce((total, item) => total + vnd(item.grossAdditionalOut) + vnd(item.grossStandardOut), BigInt(0));
    return {
      recipientKey,
      recipientLabel: input.recipientNames[recipientKey] ?? payments[0]?.recipientLabel ?? "NCC",
      actual: actual.toString(),
      requested: requested.toString(),
      paid: paid.toString(),
      outstanding: (requested > paid ? requested - paid : BigInt(0)).toString(),
      progress: requested === BigInt(0) ? "CHUA_DE_NGHI" : paid === BigInt(0) ? "CHO_THANH_TOAN" : paid < requested ? "THANH_TOAN_MOT_PHAN" : "DA_THANH_TOAN",
      milestones: input.milestones.filter(item => `VENDOR:${item.vendorId}` === recipientKey),
      requestStates: payments.map(item => ({ requestId: item.requestId, title: item.title, approvalState: item.approvalState, cashProgress: item.cashProgress })),
      occurrenceIds: occurrences.map(item => item.id),
    };
  });
  const now = input.now ?? new Date();
  const audit: ActualCostControlCenter["audit"] = [];
  for (const occurrence of allowedOccurrences) {
    if (occurrence.sourceKind === "UNBUDGETED") audit.push({ code: "UNBUDGETED", severity: "warning", label: "Phát sinh ngoài IC", occurrenceId: occurrence.id });
    if (occurrence.missingEvidenceWarnings.length) audit.push({ code: "MISSING_EVIDENCE", severity: "warning", label: occurrence.missingEvidenceWarnings.join("; "), occurrenceId: occurrence.id });
    if (occurrence.reviewState !== "approved") audit.push({ code: "UNAPPROVED", severity: "info", label: "AC chưa được DD duyệt", occurrenceId: occurrence.id });
    if (occurrence.lockedByApplications) audit.push({ code: "LOCKED", severity: "info", label: "AC đã được dùng trong hồ sơ thanh toán", occurrenceId: occurrence.id });
  }
  for (const comparison of comparisons) if (comparison.status === "OVER_BUDGET") audit.push({ code: "OVER_IC", severity: "danger", label: `Vượt IC: ${comparison.description}`, occurrenceId: comparison.actualLineIds[0] });
  const knownRequests = new Set(allowedOccurrences.flatMap(item => item.applicationRequestIds));
  for (const payment of allowedPayments) if (!knownRequests.has(payment.requestId) && payment.kind !== "ADVANCE") audit.push({ code: "UNMATCHED_PAYMENT", severity: "warning", label: `Hồ sơ chi chưa khớp AC: ${payment.title}`, requestId: payment.requestId });
  for (const milestone of input.milestones) if (new Date(`${milestone.dueDate}T23:59:59.999Z`) < now && !allowedPayments.some(item => item.requestId === milestone.linkedRequestId && item.cashProgress === "PAID")) audit.push({ code: "OVERDUE_MILESTONE", severity: "danger", label: `Mốc NCC quá hạn: ${milestone.title}`, milestoneId: milestone.id, requestId: milestone.linkedRequestId });
  const icTotal = totalCosts(comparisons.flatMap(item => item.ic ? [item.ic.cost] : []));
  const actualTotal = totalCosts(allowedOccurrences.flatMap(item => item.cost ? [item.cost] : []));
  const defaultLens = input.capabilities.account || input.capabilities.audit ? "COST_TYPES" : input.capabilities.vendorOperations ? "VENDORS" : "SELF";
  return {
    capabilities: input.capabilities,
    defaultLens,
    worksheet: { groups, unbudgeted: allowedOccurrences.filter(item => item.sourceKind === "UNBUDGETED"), totals: { ic: icTotal, actual: actualTotal, variance: subtractCosts(actualTotal, icTotal) } },
    staff,
    vendors,
    audit,
  };
}

export function operationAssignmentIds(input: string[], activeProjectMemberIds: string[]) {
  const allowed = new Set(activeProjectMemberIds);
  return [...new Set(input.map(value => value.trim()).filter(value => allowed.has(value)))].sort();
}

export function amountRelation(left: string, right: string) {
  return compare(decimal(left), decimal(right));
}
