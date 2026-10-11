import type { ApprovedActualCostLine } from "./approvedActualCost";
import { add, compare, decimal, exact, moneyInWords, round, source, sum, type Rational } from "./money";

const ZERO = decimal("0");

export const SETTLEMENT_EVIDENCE_REQUIREMENTS = [
  "RELATED_IC_AC",
  "EXPENSE_EVIDENCE",
  "DISBURSEMENT_PROOF",
] as const;

export type SettlementEvidenceRequirement = typeof SETTLEMENT_EVIDENCE_REQUIREMENTS[number];
export type SettlementMissingCode =
  | "MISSING_RELATED_IC_AC"
  | "MISSING_EXPENSE_EVIDENCE"
  | "MISSING_DISBURSEMENT_PROOF";

export type SettlementEvidenceRef = {
  id: string;
  sha256: string;
  recipientKey?: string;
  origin: "INHERITED" | "SUPPLEMENTAL";
  satisfies: SettlementEvidenceRequirement[];
};

export type SettlementApprovalTuple = {
  versionId: string;
  approvalEventId: string;
  approvalAttemptId: string;
};

export type SettlementActualCostInput = Partial<Pick<ApprovedActualCostLine,
  "lineId" | "fundingSource" | "approvedAmount">> & {
  projectId: string;
  recipientKey: string;
  recipientType: "EMPLOYEE" | "VENDOR";
  recipientName: string;
  stableLineId: string;
  versionId: string;
  approvalEventId: string | null;
  approvalAttemptId: string | null;
  approvalState: "APPROVED" | "PENDING" | "RETURNED" | "REJECTED";
  currentApprovalTuple: SettlementApprovalTuple | null;
  approvedAmount?: string;
  rawNet?: string;
  rawVat?: string;
  rawGross?: string;
  relatedIcAcReferences: Array<{ id: string; kind: "IC_LINE" | "AC_LINE" | "IC_REVISION" }>;
  evidence: SettlementEvidenceRef[];
};

export type SettlementAdvanceAllocationInput = {
  projectId: string;
  recipientKey: string;
  recipientType: "EMPLOYEE" | "VENDOR";
  recipientName: string;
  advanceRequestId: string;
  advanceLineId: string;
  cashId: string;
  allocationId: string;
  direction: "OUT" | "IN";
  cashState: "CONFIRMED" | "PENDING" | "VOID";
  rawGross: string;
  evidence: SettlementEvidenceRef[];
};

export type ProjectSettlementDraftInput = {
  projectId: string;
  actualCostLines: SettlementActualCostInput[];
  advanceAllocations: SettlementAdvanceAllocationInput[];
  supplementalEvidence?: SettlementEvidenceRef[];
};

type RecipientAccumulator = {
  recipientKey: string;
  recipientType: "EMPLOYEE" | "VENDOR";
  recipientName: string;
  actualNet: Rational[];
  actualVat: Rational[];
  actualGross: Rational[];
  advanceGross: Rational[];
  hasRelatedIcAc: boolean;
  evidence: SettlementEvidenceRef[];
};

const missingCodeByRequirement: Record<SettlementEvidenceRequirement, SettlementMissingCode> = {
  RELATED_IC_AC: "MISSING_RELATED_IC_AC",
  EXPENSE_EVIDENCE: "MISSING_EXPENSE_EVIDENCE",
  DISBURSEMENT_PROOF: "MISSING_DISBURSEMENT_PROOF",
};

function requiredText(value: string | null | undefined, label: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`Thiếu ${label} trong producer tuple quyết toán.`);
  return normalized;
}

function positiveExact(value: string | undefined, label: string) {
  if (!value) throw new Error(`Thiếu ${label} từ nguồn quyết toán.`);
  const parsed = exact(value);
  if (compare(parsed, ZERO) <= 0) throw new Error(`${label} phải là số dương.`);
  return parsed;
}

function assertRecipientIdentity(row: {
  projectId: string;
  recipientKey: string;
  recipientName: string;
  recipientType: "EMPLOYEE" | "VENDOR";
}, projectId: string) {
  if (row.projectId !== projectId) throw new Error("Không được dùng nguồn quyết toán chéo Project.");
  requiredText(row.recipientKey, "recipientKey");
  requiredText(row.recipientName, "tên người nhận");
  const expectedPrefix = row.recipientType === "EMPLOYEE" ? "USER:" : "VENDOR:";
  if (!row.recipientKey.startsWith(expectedPrefix)) throw new Error("Loại người nhận không khớp recipientKey.");
}

function assertEvidence(evidence: SettlementEvidenceRef) {
  requiredText(evidence.id, "evidence ID");
  requiredText(evidence.sha256, "evidence hash");
  if (!evidence.satisfies.length || evidence.satisfies.some(item => !SETTLEMENT_EVIDENCE_REQUIREMENTS.includes(item))) {
    throw new Error("Loại minh chứng quyết toán không hợp lệ.");
  }
}

function mergeEvidence(rows: SettlementEvidenceRef[]) {
  const byId = new Map<string, SettlementEvidenceRef>();
  for (const row of rows) {
    assertEvidence(row);
    const existing = byId.get(row.id);
    if (existing && existing.sha256 !== row.sha256) throw new Error("Minh chứng trùng ID nhưng khác hash.");
    byId.set(row.id, existing ? {
      ...existing,
      satisfies: [...new Set([...existing.satisfies, ...row.satisfies])],
    } : { ...row, satisfies: [...new Set(row.satisfies)] });
  }
  return [...byId.values()];
}

function accumulatorFor(
  recipients: Map<string, RecipientAccumulator>,
  row: {
    recipientKey: string;
    recipientType: "EMPLOYEE" | "VENDOR";
    recipientName: string;
  },
) {
  const current = recipients.get(row.recipientKey);
  if (current) {
    if (current.recipientType !== row.recipientType || current.recipientName !== row.recipientName) {
      throw new Error("Nguồn cùng recipientKey có snapshot người nhận không khớp.");
    }
    return current;
  }
  const created: RecipientAccumulator = {
    recipientKey: row.recipientKey,
    recipientType: row.recipientType,
    recipientName: row.recipientName,
    actualNet: [],
    actualVat: [],
    actualGross: [],
    advanceGross: [],
    hasRelatedIcAc: false,
    evidence: [],
  };
  recipients.set(row.recipientKey, created);
  return created;
}

function validateApprovedTuple(line: SettlementActualCostInput) {
  const tuple = {
    versionId: requiredText(line.versionId, "AC version ID"),
    approvalEventId: requiredText(line.approvalEventId, "AC approval event ID"),
    approvalAttemptId: requiredText(line.approvalAttemptId, "AC approval attempt ID"),
  };
  const current = line.currentApprovalTuple;
  if (!current
    || tuple.versionId !== current.versionId
    || tuple.approvalEventId !== current.approvalEventId
    || tuple.approvalAttemptId !== current.approvalAttemptId) {
    throw new Error("Producer tuple AC đã stale hoặc không khớp phiên bản/approval hiện hành.");
  }
  return tuple;
}

function actualComponents(line: SettlementActualCostInput) {
  const gross = positiveExact(line.rawGross ?? line.approvedAmount, "AC gross");
  const net = line.rawNet ? positiveExact(line.rawNet, "AC net") : gross;
  const vat = line.rawVat ? exact(line.rawVat) : ZERO;
  if (compare(vat, ZERO) < 0 || compare(add(net, vat), gross) !== 0) {
    throw new Error("Nguồn AC phải giữ đúng đẳng thức raw Net + VAT = Gross.");
  }
  return { net, vat, gross };
}

export function roundSettlementVnd(value: string) {
  return round(exact(value));
}

export function aggregateSettlementVnd(values: string[]) {
  const raw = sum(values.map(value => exact(value)));
  return { raw: source(raw), rounded: round(raw) };
}

export function balanceSettlementComponents(input: {
  rawNet: string;
  rawVat: string;
  rawGross: string;
}) {
  const rawNet = exact(input.rawNet);
  const rawVat = exact(input.rawVat);
  const rawGross = exact(input.rawGross);
  if (compare(add(rawNet, rawVat), rawGross) !== 0) {
    throw new Error("Nguồn tiền phải giữ đúng đẳng thức raw Net + VAT = Gross.");
  }
  const net = BigInt(round(rawNet));
  const gross = BigInt(round(rawGross));
  return {
    rawNet: source(rawNet),
    rawVat: source(rawVat),
    rawGross: source(rawGross),
    net: net.toString(),
    vat: (gross - net).toString(),
    gross: gross.toString(),
  };
}

function roundedActual(rows: Pick<RecipientAccumulator, "actualNet" | "actualVat" | "actualGross">) {
  const rawNet = sum(rows.actualNet);
  const rawVat = sum(rows.actualVat);
  const rawGross = sum(rows.actualGross);
  return balanceSettlementComponents({
    rawNet: source(rawNet),
    rawVat: source(rawVat),
    rawGross: source(rawGross),
  });
}

export function projectSettlementLifecycleCashEffects(action:
  | "CREATE"
  | "SUBMIT"
  | "MANAGER_APPROVE"
  | "ACCOUNTANT_APPROVE"
  | "CEO_APPROVE"
  | "RETURN") {
  void action;
  return [] as const;
}

export function buildProjectSettlementDraft(input: ProjectSettlementDraftInput) {
  const projectId = requiredText(input.projectId, "Project ID");
  const recipients = new Map<string, RecipientAccumulator>();
  const warnings: Array<{
    code: "UNAPPROVED_AC";
    stableLineId: string;
    recipientKey: string;
    approvalState: SettlementActualCostInput["approvalState"];
  }> = [];
  const actualManifest: Array<{
    projectId: string;
    recipientKey: string;
    stableLineId: string;
    versionId: string;
    approvalEventId: string;
    approvalAttemptId: string;
  }> = [];
  const allocationManifest: Array<{
    projectId: string;
    recipientKey: string;
    advanceRequestId: string;
    advanceLineId: string;
    cashId: string;
    allocationId: string;
  }> = [];

  const approvedStableIds = new Set<string>();
  for (const line of input.actualCostLines) {
    assertRecipientIdentity(line, projectId);
    requiredText(line.stableLineId, "AC stable line ID");
    if (line.approvalState !== "APPROVED") {
      warnings.push({
        code: "UNAPPROVED_AC",
        stableLineId: line.stableLineId,
        recipientKey: line.recipientKey,
        approvalState: line.approvalState,
      });
      continue;
    }
    if (approvedStableIds.has(line.stableLineId)) throw new Error("Dòng AC đã duyệt bị trùng hoặc tái sử dụng.");
    approvedStableIds.add(line.stableLineId);
    const tuple = validateApprovedTuple(line);
    const amounts = actualComponents(line);
    const recipient = accumulatorFor(recipients, line);
    recipient.actualNet.push(amounts.net);
    recipient.actualVat.push(amounts.vat);
    recipient.actualGross.push(amounts.gross);
    recipient.hasRelatedIcAc ||= line.relatedIcAcReferences.length > 0;
    recipient.evidence.push(...line.evidence);
    actualManifest.push({
      projectId,
      recipientKey: line.recipientKey,
      stableLineId: line.stableLineId,
      ...tuple,
    });
  }

  const allocationIds = new Set<string>();
  for (const allocation of input.advanceAllocations) {
    assertRecipientIdentity(allocation, projectId);
    const allocationId = requiredText(allocation.allocationId, "cash allocation ID");
    if (allocationIds.has(allocationId)) throw new Error("Cash allocation bị trùng hoặc đã tái sử dụng.");
    allocationIds.add(allocationId);
    if (allocation.direction !== "OUT" || allocation.cashState !== "CONFIRMED") {
      throw new Error("Chỉ cash allocation OUT đã chi và CONFIRMED được đưa vào quyết toán.");
    }
    const recipient = accumulatorFor(recipients, allocation);
    recipient.advanceGross.push(positiveExact(allocation.rawGross, "tạm ứng đã giải ngân"));
    recipient.evidence.push(...allocation.evidence);
    allocationManifest.push({
      projectId,
      recipientKey: allocation.recipientKey,
      advanceRequestId: requiredText(allocation.advanceRequestId, "advance request ID"),
      advanceLineId: requiredText(allocation.advanceLineId, "advance line ID"),
      cashId: requiredText(allocation.cashId, "cash ID"),
      allocationId,
    });
  }

  const supplementalByRecipient = new Map<string, SettlementEvidenceRef[]>();
  for (const evidence of input.supplementalEvidence ?? []) {
    assertEvidence(evidence);
    const recipientKey = requiredText(evidence.recipientKey, "recipientKey của minh chứng bổ sung");
    if (!recipients.has(recipientKey)) throw new Error("Minh chứng bổ sung không thuộc người nhận trong draft.");
    supplementalByRecipient.set(recipientKey, [...(supplementalByRecipient.get(recipientKey) ?? []), evidence]);
  }

  const recipientRows = [...recipients.values()].map(recipient => {
    const actual = roundedActual(recipient);
    const advanceGross = BigInt(round(sum(recipient.advanceGross)));
    const actualGross = BigInt(actual.gross);
    const refundDue = advanceGross > actualGross ? advanceGross - actualGross : BigInt(0);
    const additionalDue = actualGross > advanceGross ? actualGross - advanceGross : BigInt(0);
    const voucherType = advanceGross > BigInt(0) ? "DNHTU" as const : "DNTT" as const;
    const evidenceManifest = mergeEvidence([
      ...recipient.evidence,
      ...(supplementalByRecipient.get(recipient.recipientKey) ?? []),
    ]);
    const satisfied = new Set(evidenceManifest.flatMap(item => item.satisfies));
    if (recipient.hasRelatedIcAc) satisfied.add("RELATED_IC_AC");
    const missingCodes = voucherType === "DNHTU"
      ? SETTLEMENT_EVIDENCE_REQUIREMENTS
        .filter(requirement => !satisfied.has(requirement))
        .map(requirement => missingCodeByRequirement[requirement])
      : [];
    return {
      obligationId: `${projectId}:${recipient.recipientKey}`,
      projectId,
      recipientKey: recipient.recipientKey,
      recipientType: recipient.recipientType,
      recipientName: recipient.recipientName,
      voucherType,
      actualNet: actual.net,
      actualVat: actual.vat,
      actualGross: actual.gross,
      rawActual: { net: actual.rawNet, vat: actual.rawVat, gross: actual.rawGross },
      advanceGross: advanceGross.toString(),
      refundDue: refundDue.toString(),
      additionalDue: additionalDue.toString(),
      remainingBalance: (actualGross - advanceGross).toString(),
      amountInWordsInput: actual.gross,
      amountInWords: moneyInWords(actual.gross),
      evidenceManifest,
      evidenceCompleteness: { complete: missingCodes.length === 0, missingCodes },
      projectionContract: {
        service: actual.gross,
        xlsx: actual.gross,
        pdf: actual.gross,
        moneyInWords: actual.gross,
      },
    };
  });

  const submitBlockers: Array<{
    code: "UNAPPROVED_AC" | SettlementMissingCode;
    recipientKey: string;
    stableLineId?: string;
  }> = warnings.map(warning => ({
    code: warning.code,
    recipientKey: warning.recipientKey,
    stableLineId: warning.stableLineId,
  }));
  for (const recipient of recipientRows) {
    for (const code of recipient.evidenceCompleteness.missingCodes) {
      submitBlockers.push({ code, recipientKey: recipient.recipientKey });
    }
  }

  const totalActualRaw = sum([...recipients.values()].flatMap(recipient => recipient.actualGross));
  const totalAdvanceRaw = sum([...recipients.values()].flatMap(recipient => recipient.advanceGross));
  const totalRefund = recipientRows.reduce((total, row) => total + BigInt(row.refundDue), BigInt(0));
  const totalAdditional = recipientRows.reduce((total, row) => total + BigInt(row.additionalDue), BigInt(0));

  return {
    projectId,
    recipients: recipientRows,
    sourceManifest: { actualCosts: actualManifest, advanceAllocations: allocationManifest },
    warnings,
    submitBlockers,
    canSubmit: recipientRows.length > 0 && submitBlockers.length === 0,
    totals: {
      rawActualGross: source(totalActualRaw),
      actualGross: round(totalActualRaw),
      advanceGross: round(totalAdvanceRaw),
      refundDue: totalRefund.toString(),
      additionalDue: totalAdditional.toString(),
    },
    cashWrites: projectSettlementLifecycleCashEffects("CREATE"),
  };
}
