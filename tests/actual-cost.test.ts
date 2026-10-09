import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateActualCost,
  nextActualCostVersion,
  normalizeLegacyActualCosts,
  validateActualCostDecision,
} from "../lib/costflow/actualCost";

test("actual cost: derives the approved VND amount from quantity, days and unit price", () => {
  const result = calculateActualCost({
    quantity: "2.5",
    days: "3",
    unitPrice: "100000",
  });

  assert.equal(result.amount, "750000");
  assert.equal(result.rawAmount, "750000/1");
});

test("actual cost: only the active AC_DD holder may APPROVE", () => {
  assert.deepEqual(
    validateActualCostDecision({
      action: "APPROVED",
      actorId: "dd-1",
      activeDdIds: ["dd-1"],
      expectedVersion: 1,
      currentVersion: 1,
      reason: "Đã kiểm tra chi phí thực tế.",
    }),
    { action: "APPROVED", reason: "Đã kiểm tra chi phí thực tế." },
  );

  assert.throws(
    () => validateActualCostDecision({
      action: "APPROVED",
      actorId: "admin-without-dd",
      activeDdIds: ["dd-1"],
      expectedVersion: 1,
      currentVersion: 1,
      reason: "Admin không đồng nghĩa DD.",
    }),
    /AC_DD/,
  );
  assert.throws(
    () => validateActualCostDecision({
      action: "APPROVED",
      actorId: "dd-1",
      activeDdIds: [],
      expectedVersion: 1,
      currentVersion: 1,
      reason: "Không có DD.",
    }),
    /duy nhất một AC_DD/,
  );
  assert.throws(
    () => validateActualCostDecision({
      action: "APPROVED",
      actorId: "dd-1",
      activeDdIds: ["dd-1", "dd-2"],
      expectedVersion: 1,
      currentVersion: 1,
      reason: "Hai DD.",
    }),
    /duy nhất một AC_DD/,
  );
});

test("actual cost: RETURNED requires a reason and stale or replayed decisions fail", () => {
  assert.throws(
    () => validateActualCostDecision({
      action: "RETURNED",
      actorId: "dd-1",
      activeDdIds: ["dd-1"],
      expectedVersion: 1,
      currentVersion: 1,
      reason: "",
    }),
    /lý do/,
  );
  assert.throws(
    () => validateActualCostDecision({
      action: "APPROVED",
      actorId: "dd-1",
      activeDdIds: ["dd-1"],
      expectedVersion: 1,
      currentVersion: 2,
      reason: "Lệnh cũ.",
    }),
    /phiên bản đã thay đổi/,
  );
  assert.equal(nextActualCostVersion(1, "RETURNED"), 2);
  assert.throws(() => nextActualCostVersion(1, "APPROVED"), /RETURNED/);
});

test("actual cost: legacy Expense JSON remains legacy/needsReview and never becomes approved", () => {
  const legacy = normalizeLegacyActualCosts([
    {
      id: "legacy-expense-1",
      revisionId: "ic-revision-1",
      lineId: "ic-line-1",
      recipientKey: "USER:user-1",
      description: "Chi phí cũ",
      input: { quantity: "1", unitPrice: "100000", basis: "GROSS", vatPercent: "0" },
      cost: { rawNet: "100000/1", rawVat: "0/1", rawGross: "100000/1", net: "100000", vat: "0", gross: "100000" },
      invoiceId: "invoice-1",
      paymentProofId: "proof-1",
      createdBy: "user-1",
    },
  ]);

  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].source, "legacy");
  assert.equal(legacy[0].reviewState, "needsReview");
  assert.equal(legacy[0].approvalState, null);
});
