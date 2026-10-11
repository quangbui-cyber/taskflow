import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSettlementVnd,
  balanceSettlementComponents,
  buildProjectSettlementDraft,
  roundSettlementVnd,
} from "../lib/costflow/projectSettlement.ts";

const projectId = "project-voucher-route";

function approvedActual(recipientKey, overrides = {}) {
  const suffix = recipientKey.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  return {
    projectId,
    recipientKey,
    recipientType: recipientKey.startsWith("VENDOR:") ? "VENDOR" : "EMPLOYEE",
    recipientName: suffix,
    stableLineId: `ac-${suffix}`,
    versionId: `version-${suffix}`,
    approvalEventId: `event-${suffix}`,
    approvalAttemptId: `attempt-${suffix}`,
    currentApprovalTuple: {
      versionId: `version-${suffix}`,
      approvalEventId: `event-${suffix}`,
      approvalAttemptId: `attempt-${suffix}`,
    },
    approvalState: "APPROVED",
    rawNet: "8000000",
    rawVat: "0",
    rawGross: "8000000",
    relatedIcAcReferences: [{ id: `ic-${suffix}`, kind: "IC_LINE" }],
    evidence: [{ id: `invoice-${suffix}`, sha256: `invoice-${suffix}-sha`, origin: "INHERITED", satisfies: ["EXPENSE_EVIDENCE"] }],
    ...overrides,
  };
}

function advance(recipientKey, overrides = {}) {
  const suffix = recipientKey.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  return {
    projectId,
    recipientKey,
    recipientType: recipientKey.startsWith("VENDOR:") ? "VENDOR" : "EMPLOYEE",
    recipientName: suffix,
    advanceRequestId: `request-${suffix}`,
    advanceLineId: `advance-line-${suffix}`,
    cashId: `cash-${suffix}`,
    allocationId: `allocation-${suffix}`,
    direction: "OUT",
    cashState: "CONFIRMED",
    rawGross: "10000000",
    evidence: [{ id: `cash-proof-${suffix}`, sha256: `cash-proof-${suffix}-sha`, origin: "INHERITED", satisfies: ["DISBURSEMENT_PROOF"] }],
    ...overrides,
  };
}

test("voucher routing: advance recipients use DNHTU while zero-advance recipients use DNTT", () => {
  const result = buildProjectSettlementDraft({
    projectId,
    actualCostLines: [
      approvedActual("USER:advanced"),
      approvedActual("VENDOR:unadvanced", { rawNet: "5000000", rawGross: "5000000" }),
    ],
    advanceAllocations: [advance("USER:advanced")],
  });
  const advanced = result.recipients.find(row => row.recipientKey === "USER:advanced");
  const unadvanced = result.recipients.find(row => row.recipientKey === "VENDOR:unadvanced");

  assert.equal(advanced.voucherType, "DNHTU");
  assert.equal(advanced.refundDue, "2000000");
  assert.equal(advanced.additionalDue, "0");
  assert.equal(unadvanced.voucherType, "DNTT");
  assert.equal(unadvanced.advanceGross, "0");
  assert.equal(unadvanced.additionalDue, "5000000");
});

test("voucher routing: project and recipient grouping never crosses source ownership", () => {
  const result = buildProjectSettlementDraft({
    projectId,
    actualCostLines: [approvedActual("USER:a"), approvedActual("USER:b", { rawNet: "12000000", rawGross: "12000000" })],
    advanceAllocations: [advance("USER:a"), advance("USER:b", { rawGross: "3000000" })],
  });
  const a = result.recipients.find(row => row.recipientKey === "USER:a");
  const b = result.recipients.find(row => row.recipientKey === "USER:b");

  assert.deepEqual({ actual: a.actualGross, advance: a.advanceGross, balance: a.remainingBalance }, {
    actual: "8000000",
    advance: "10000000",
    balance: "-2000000",
  });
  assert.deepEqual({ actual: b.actualGross, advance: b.advanceGross, balance: b.remainingBalance }, {
    actual: "12000000",
    advance: "3000000",
    balance: "9000000",
  });
  assert.deepEqual(result.sourceManifest.actualCosts.filter(row => row.recipientKey === "USER:a").map(row => row.stableLineId), ["ac-user-a"]);
  assert.deepEqual(result.sourceManifest.advanceAllocations.filter(row => row.recipientKey === "USER:b").map(row => row.allocationId), ["allocation-user-b"]);
});

test("SET-06 rounding: exact halves round away from zero", () => {
  assert.equal(roundSettlementVnd("100.5"), "101");
  assert.equal(roundSettlementVnd("-100.5"), "-101");
  assert.equal(roundSettlementVnd("100.4"), "100");
  assert.equal(roundSettlementVnd("-100.4"), "-100");
});

test("SET-06 rounding: unrounded originals are summed before the aggregate is rounded", () => {
  assert.deepEqual(aggregateSettlementVnd(["100.4", "100.4", "100.4"]), {
    raw: "1506/5",
    rounded: "301",
  });
});

test("SET-06 VAT balance: rounded gross is authoritative and component difference goes to VAT", () => {
  assert.deepEqual(balanceSettlementComponents({
    rawNet: "250/27",
    rawVat: "20/27",
    rawGross: "10",
  }), {
    rawNet: "250/27",
    rawVat: "20/27",
    rawGross: "10/1",
    net: "9",
    vat: "1",
    gross: "10",
  });

  const result = buildProjectSettlementDraft({
    projectId,
    actualCostLines: [approvedActual("USER:vat", {
      rawNet: "250/27",
      rawVat: "20/27",
      rawGross: "10",
    })],
    advanceAllocations: [],
  });
  const recipient = result.recipients[0];
  assert.equal(BigInt(recipient.actualNet) + BigInt(recipient.actualVat), BigInt(recipient.actualGross));
});

test("SET-06 projection: service, XLSX, PDF, numeric total, and money-in-words share one rounded gross", () => {
  const result = buildProjectSettlementDraft({
    projectId,
    actualCostLines: [
      approvedActual("USER:words", { rawNet: "100.4", rawVat: "0", rawGross: "100.4" }),
      approvedActual("USER:words", {
        stableLineId: "ac-user-words-2",
        versionId: "version-user-words-2",
        approvalEventId: "event-user-words-2",
        approvalAttemptId: "attempt-user-words-2",
        currentApprovalTuple: {
          versionId: "version-user-words-2",
          approvalEventId: "event-user-words-2",
          approvalAttemptId: "attempt-user-words-2",
        },
        rawNet: "100.4",
        rawVat: "0",
        rawGross: "100.4",
      }),
      approvedActual("USER:words", {
        stableLineId: "ac-user-words-3",
        versionId: "version-user-words-3",
        approvalEventId: "event-user-words-3",
        approvalAttemptId: "attempt-user-words-3",
        currentApprovalTuple: {
          versionId: "version-user-words-3",
          approvalEventId: "event-user-words-3",
          approvalAttemptId: "attempt-user-words-3",
        },
        rawNet: "100.4",
        rawVat: "0",
        rawGross: "100.4",
      }),
    ],
    advanceAllocations: [],
  });
  const recipient = result.recipients[0];

  assert.equal(recipient.actualGross, "301");
  assert.equal(recipient.amountInWordsInput, recipient.actualGross);
  assert.equal(recipient.amountInWords, "Ba trăm lẻ một đồng");
  assert.deepEqual(new Set(Object.values(recipient.projectionContract)), new Set(["301"]));
  assert.equal(result.totals.actualGross, "301");
});
