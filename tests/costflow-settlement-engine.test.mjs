import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectSettlementDraft,
  projectSettlementLifecycleCashEffects,
} from "../lib/costflow/projectSettlement.ts";

const projectId = "project-settlement";

function approvedActual(overrides = {}) {
  return {
    projectId,
    recipientKey: "USER:account-a",
    recipientType: "EMPLOYEE",
    recipientName: "Account A",
    stableLineId: "ac-line-a",
    versionId: "ac-version-a",
    approvalEventId: "ac-event-a",
    approvalAttemptId: "ac-attempt-a",
    currentApprovalTuple: {
      versionId: "ac-version-a",
      approvalEventId: "ac-event-a",
      approvalAttemptId: "ac-attempt-a",
    },
    approvalState: "APPROVED",
    rawNet: "7407407.407407407407",
    rawVat: "592592.592592592593",
    rawGross: "8000000",
    relatedIcAcReferences: [{ id: "ic-line-a", kind: "IC_LINE" }],
    evidence: [{
      id: "invoice-a",
      sha256: "invoice-a-sha",
      origin: "INHERITED",
      satisfies: ["EXPENSE_EVIDENCE"],
    }],
    ...overrides,
  };
}

function disbursedAdvance(overrides = {}) {
  return {
    projectId,
    recipientKey: "USER:account-a",
    recipientType: "EMPLOYEE",
    recipientName: "Account A",
    advanceRequestId: "advance-request-a",
    advanceLineId: "advance-line-a",
    cashId: "cash-a",
    allocationId: "allocation-a",
    direction: "OUT",
    cashState: "CONFIRMED",
    rawGross: "10000000",
    evidence: [{
      id: "cash-proof-a",
      sha256: "cash-proof-a-sha",
      origin: "INHERITED",
      satisfies: ["DISBURSEMENT_PROOF"],
    }],
    ...overrides,
  };
}

test("settlement engine: projects exact approved AC and confirmed allocations for multiple recipients", () => {
  const pending = approvedActual({
    stableLineId: "ac-line-pending",
    approvalState: "PENDING",
    versionId: "ac-version-pending",
    approvalEventId: null,
    approvalAttemptId: null,
    currentApprovalTuple: null,
    rawGross: "9000000",
  });
  const vendor = approvedActual({
    recipientKey: "VENDOR:vendor-b",
    recipientType: "VENDOR",
    recipientName: "Vendor B",
    stableLineId: "ac-line-b",
    versionId: "ac-version-b",
    approvalEventId: "ac-event-b",
    approvalAttemptId: "ac-attempt-b",
    currentApprovalTuple: {
      versionId: "ac-version-b",
      approvalEventId: "ac-event-b",
      approvalAttemptId: "ac-attempt-b",
    },
    rawNet: "5000000",
    rawVat: "400000",
    rawGross: "5400000",
    relatedIcAcReferences: [{ id: "ic-line-b", kind: "IC_LINE" }],
    evidence: [{ id: "invoice-b", sha256: "invoice-b-sha", origin: "INHERITED", satisfies: ["EXPENSE_EVIDENCE"] }],
  });
  const result = buildProjectSettlementDraft({
    projectId,
    actualCostLines: [approvedActual(), pending, vendor],
    advanceAllocations: [
      disbursedAdvance(),
      disbursedAdvance({
        recipientKey: "VENDOR:vendor-b",
        recipientType: "VENDOR",
        recipientName: "Vendor B",
        advanceRequestId: "advance-request-b",
        advanceLineId: "advance-line-b",
        cashId: "cash-b",
        allocationId: "allocation-b",
        rawGross: "3000000",
        evidence: [{ id: "cash-proof-b", sha256: "cash-proof-b-sha", origin: "INHERITED", satisfies: ["DISBURSEMENT_PROOF"] }],
      }),
    ],
  });

  assert.deepEqual(result.recipients.map(row => row.recipientKey), ["USER:account-a", "VENDOR:vendor-b"]);
  assert.deepEqual(result.recipients.map(row => ({
    recipientKey: row.recipientKey,
    actualGross: row.actualGross,
    advanceGross: row.advanceGross,
    refundDue: row.refundDue,
    additionalDue: row.additionalDue,
  })), [
    { recipientKey: "USER:account-a", actualGross: "8000000", advanceGross: "10000000", refundDue: "2000000", additionalDue: "0" },
    { recipientKey: "VENDOR:vendor-b", actualGross: "5400000", advanceGross: "3000000", refundDue: "0", additionalDue: "2400000" },
  ]);
  assert.deepEqual(result.sourceManifest.actualCosts.map(source => source.stableLineId), ["ac-line-a", "ac-line-b"]);
  assert.deepEqual(result.sourceManifest.advanceAllocations.map(source => source.allocationId), ["allocation-a", "allocation-b"]);
  assert.deepEqual(result.warnings.map(warning => warning.code), ["UNAPPROVED_AC"]);
  assert.equal(result.warnings[0].stableLineId, "ac-line-pending");
  assert.equal(result.submitBlockers.some(blocker => blocker.code === "UNAPPROVED_AC"), true);
  assert.equal(result.canSubmit, false);
  assert.deepEqual(result.cashWrites, []);
});

test("settlement engine: keeps ANSWER-008 diagnostics distinct and independently resolvable", () => {
  const missing = buildProjectSettlementDraft({
    projectId,
    actualCostLines: [approvedActual({ relatedIcAcReferences: [], evidence: [] })],
    advanceAllocations: [disbursedAdvance({ evidence: [] })],
  });
  assert.deepEqual(missing.recipients[0].evidenceCompleteness.missingCodes, [
    "MISSING_RELATED_IC_AC",
    "MISSING_EXPENSE_EVIDENCE",
    "MISSING_DISBURSEMENT_PROOF",
  ]);
  assert.equal(missing.canSubmit, false);
  assert.equal(missing.warnings.length, 0);

  const oneResolved = buildProjectSettlementDraft({
    projectId,
    actualCostLines: [approvedActual({ relatedIcAcReferences: [], evidence: [] })],
    advanceAllocations: [disbursedAdvance({ evidence: [] })],
    supplementalEvidence: [{
      id: "supplemental-ic-reference",
      sha256: "supplemental-ic-reference-sha",
      recipientKey: "USER:account-a",
      origin: "SUPPLEMENTAL",
      satisfies: ["RELATED_IC_AC"],
    }],
  });
  assert.deepEqual(oneResolved.recipients[0].evidenceCompleteness.missingCodes, [
    "MISSING_EXPENSE_EVIDENCE",
    "MISSING_DISBURSEMENT_PROOF",
  ]);
  assert.equal(oneResolved.submitBlockers.some(blocker => blocker.code === "UNAPPROVED_AC"), false);
});

test("settlement engine: inherited and supplemental evidence satisfy the fixed set without duplicate files", () => {
  const sharedEvidence = {
    id: "combined-proof",
    sha256: "combined-proof-sha",
    recipientKey: "USER:account-a",
    origin: "SUPPLEMENTAL",
    satisfies: ["RELATED_IC_AC", "EXPENSE_EVIDENCE", "DISBURSEMENT_PROOF"],
  };
  const result = buildProjectSettlementDraft({
    projectId,
    actualCostLines: [approvedActual({ relatedIcAcReferences: [], evidence: [] })],
    advanceAllocations: [disbursedAdvance({ evidence: [] })],
    supplementalEvidence: [sharedEvidence, sharedEvidence],
  });

  assert.equal(result.canSubmit, true);
  assert.deepEqual(result.recipients[0].evidenceCompleteness.missingCodes, []);
  assert.deepEqual(result.recipients[0].evidenceManifest.map(item => item.id), ["combined-proof"]);
});

test("settlement engine: fails closed on missing, stale, foreign, or duplicate producer tuples", () => {
  const input = { projectId, actualCostLines: [approvedActual()], advanceAllocations: [disbursedAdvance()] };
  assert.throws(
    () => buildProjectSettlementDraft({ ...input, actualCostLines: [approvedActual({ approvalEventId: "" })] }),
    /approval|nguồn|tuple/i,
  );
  assert.throws(
    () => buildProjectSettlementDraft({ ...input, actualCostLines: [approvedActual({ currentApprovalTuple: { versionId: "ac-version-new", approvalEventId: "ac-event-new", approvalAttemptId: "ac-attempt-new" } })] }),
    /stale|phiên bản|khớp/i,
  );
  assert.throws(
    () => buildProjectSettlementDraft({ ...input, actualCostLines: [approvedActual({ projectId: "foreign-project" })] }),
    /project/i,
  );
  assert.throws(
    () => buildProjectSettlementDraft({ ...input, advanceAllocations: [disbursedAdvance(), disbursedAdvance()] }),
    /trùng|duplicate|tái sử dụng/i,
  );
  assert.throws(
    () => buildProjectSettlementDraft({ ...input, advanceAllocations: [disbursedAdvance({ cashState: "PENDING" })] }),
    /đã chi|disbursed|confirmed/i,
  );
});

test("settlement engine: lifecycle decisions and customer-side values remain cash neutral", () => {
  for (const action of ["CREATE", "SUBMIT", "MANAGER_APPROVE", "ACCOUNTANT_APPROVE", "CEO_APPROVE", "RETURN"]) {
    assert.deepEqual(projectSettlementLifecycleCashEffects(action), []);
  }

  const base = { projectId, actualCostLines: [approvedActual()], advanceAllocations: [disbursedAdvance()] };
  const withoutCustomer = buildProjectSettlementDraft(base);
  const withCustomer = buildProjectSettlementDraft({
    ...base,
    customerLiquidation: { grossAmount: "999999999999" },
    customerCashIns: [{ amount: "999999999999" }],
  });
  assert.deepEqual(withCustomer.totals, withoutCustomer.totals);
  assert.deepEqual(withCustomer.recipients, withoutCustomer.recipients);
  assert.deepEqual(withCustomer.cashWrites, []);
});
