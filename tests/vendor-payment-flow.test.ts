import test from "node:test";
import assert from "node:assert/strict";
import { calculateCost } from "../lib/costflow/money";
import { validateIcEvidence, validateIcSubmissionEvidence } from "../lib/costflow/icEvidence";
import { normalizeVendorPaymentSchedule } from "../lib/costflow/vendorPaymentSchedule";
import type { IcRevision, VendorPaymentMilestone } from "../lib/costflow/types";

const revision: IcRevision = {
  id: "ic-1",
  number: 1,
  requestId: "request-1",
  effective: true,
  createdBy: "account",
  poIds: [],
  lines: [
    { id: "line-a", description: "Lưu trú", unit: "gói", quantity: "1", days: "1", unitPrice: "60000000", vatPercent: "0", basis: "NET", vendorId: "vendor-1", evidenceIds: ["quote-a"], cost: calculateCost({ quantity: "1", unitPrice: "60000000", vatPercent: "0", basis: "NET" }) },
    { id: "line-b", description: "Teambuilding", unit: "gói", quantity: "1", days: "1", unitPrice: "40000000", vatPercent: "0", basis: "NET", vendorId: "vendor-1", evidenceIds: ["quote-b"], cost: calculateCost({ quantity: "1", unitPrice: "40000000", vatPercent: "0", basis: "NET" }) },
  ],
};

function milestone(overrides: Partial<VendorPaymentMilestone> = {}): VendorPaymentMilestone {
  return {
    id: "m-1",
    vendorId: "vendor-1",
    revisionId: "ic-1",
    installmentNumber: 1,
    title: "Đợt cọc",
    percentage: 0,
    amount: "50000000",
    dueDate: "2026-10-20",
    paymentMethod: "ADVANCE",
    kind: "PLANNED",
    lineAllocations: [{ lineId: "line-a", amount: "30000000" }, { lineId: "line-b", amount: "20000000" }],
    ...overrides,
  };
}

test("IC draft may keep a reason, but submission requires a file on every line", () => {
  const reasonOnly = [{ ...revision.lines[0], evidenceIds: [], evidenceReason: "Đang chờ báo giá" }];
  assert.doesNotThrow(() => validateIcEvidence(reasonOnly));
  assert.throws(() => validateIcSubmissionEvidence(reasonOnly), /phải có file minh chứng/);
  assert.doesNotThrow(() => validateIcSubmissionEvidence(revision.lines));
});

test("vendor schedule derives percentage from IC allocations and may stay below 100 percent", () => {
  const result = normalizeVendorPaymentSchedule({ revision, vendorId: "vendor-1", milestones: [milestone()] });
  assert.equal(result[0].amount, "50000000");
  assert.equal(result[0].percentage, 50);
  assert.equal(result[0].paymentMethod, "ADVANCE");
  assert.deepEqual(result[0].lineAllocations, [{ lineId: "line-a", amount: "30000000" }, { lineId: "line-b", amount: "20000000" }]);
});

test("vendor schedule rejects wrong IC lines, over-allocation and pre-AC DNTT", () => {
  assert.throws(() => normalizeVendorPaymentSchedule({ revision, vendorId: "vendor-1", milestones: [milestone({ lineAllocations: [{ lineId: "foreign", amount: "50000000" }] })] }), /không thuộc NCC hoặc IC/);
  assert.throws(() => normalizeVendorPaymentSchedule({ revision, vendorId: "vendor-1", milestones: [milestone({ amount: "70000000", lineAllocations: [{ lineId: "line-a", amount: "70000000" }] })] }), /vượt ngân sách GROSS/);
  assert.throws(() => normalizeVendorPaymentSchedule({ revision, vendorId: "vendor-1", milestones: [milestone({ paymentMethod: "VENDOR_DIRECT" })] }), /phải phát hành dưới ĐNTU/);
});
