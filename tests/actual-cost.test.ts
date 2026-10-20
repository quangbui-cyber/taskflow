import test from "node:test";
import assert from "node:assert/strict";

import {
  actualCostVariance,
  actualCostEvidenceWarnings,
  calculateActualCost,
  nextActualCostVersion,
  validateUnbudgetedActualCost,
  validateActualCostDecision,
} from "../lib/costflow/actualCost";

test("actual cost: evidence warnings are explicit and independent from approval", () => {
  assert.deepEqual(actualCostEvidenceWarnings([]), ["MISSING_ACCEPTANCE_HANDOVER", "MISSING_VAT_INVOICE", "MISSING_PAYMENT_PROOF"]);
  assert.deepEqual(actualCostEvidenceWarnings(["VAT_INVOICE", "PAYMENT_PROOF"]), ["MISSING_ACCEPTANCE_HANDOVER"]);
});

test("actual cost: derives the approved VND amount from quantity, days and unit price", () => {
  const result = calculateActualCost({
    quantity: "2.5",
    days: "3",
    unitPrice: "100000",
  });

  assert.equal(result.amount, "750000");
  assert.equal(result.rawAmount, "750000/1");
});

test("actual cost: derives exact NET/VAT/GROSS and signed AC minus IC variance", () => {
  const first = calculateActualCost({ quantity: "2.5", days: "2", unitPrice: "100000", basis: "NET", vatPercent: "10" });
  const second = calculateActualCost({ quantity: "1", days: "1", unitPrice: "50000", basis: "GROSS", vatPercent: "0" });
  assert.deepEqual(first.cost, {
    rawNet: "500000/1", rawVat: "50000/1", rawGross: "550000/1",
    net: "500000", vat: "50000", gross: "550000",
  });
  assert.equal(first.amount, "550000");
  const comparison = actualCostVariance(
    { rawNet: "500000/1", rawVat: "50000/1", rawGross: "550000/1", net: "500000", vat: "50000", gross: "550000" },
    [first.cost, second.cost],
  );
  assert.equal(comparison.actual.gross, "600000");
  assert.equal(comparison.variance.gross, "50000");
  assert.equal(comparison.status, "OVER_BUDGET");
});

test("actual cost: validates explicit unbudgeted provenance and keeps billable sale metadata separate", () => {
  assert.throws(() => validateUnbudgetedActualCost({
    description: "Phát sinh vận chuyển", reason: "", fundingSource: "VENDOR_PAYMENT",
    recipientKey: "VENDOR:one", quantity: "1", days: "1", unitPrice: "100000",
    unit: "gói", evidenceIds: ["evidence-1"], billable: true,
    saleQuantity: "1", saleDays: "1", saleUnitPrice: "120000",
  }), /lý do phát sinh/);
  const validated = validateUnbudgetedActualCost({
    description: "Phát sinh vận chuyển", reason: "Khách đổi địa điểm", fundingSource: "VENDOR_PAYMENT",
    recipientKey: "VENDOR:one", quantity: "1", days: "1", unitPrice: "100000",
    unit: "gói", evidenceIds: ["evidence-1"], billable: true,
    saleQuantity: "1", saleDays: "1", saleUnitPrice: "120000",
  });
  assert.equal(validated.cost.gross, "100000");
  assert.deepEqual(validated.saleSnapshot, { quantity: "1", days: "1", unitPrice: "120000" });
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
