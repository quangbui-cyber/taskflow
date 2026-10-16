import assert from "node:assert/strict";
import test from "node:test";
import { validateVendorPaymentSelection } from "../lib/costflow/vendorPaymentService.ts";

const base = {
  projectId: "project-a",
  recipientKey: "SUPPLIER:supplier-a:bank-a",
  invoiceGross: "1100",
  lines: [
    { projectId: "project-a", stableLineId: "ac-1", versionId: "v-1", approvalId: "approval-1", approvalAttemptId: "attempt-1", fundingSource: "VENDOR_PAYMENT", recipientKey: "SUPPLIER:supplier-a:bank-a", approvedAmount: "1100", alreadyApplied: "0", amount: "1100", sourceKind: "IC_LINKED" },
  ],
};

test("accepts exact approved-AC vendor payment allocation", () => {
  assert.equal(validateVendorPaymentSelection(base).totalAmount, "1100");
});

test("rejects over-application, mixed supplier, unapproved/legacy sources and duplicate refs", () => {
  assert.throws(() => validateVendorPaymentSelection({ ...base, lines: [{ ...base.lines[0], amount: "1101" }] }), /vượt phần AC/i);
  assert.throws(() => validateVendorPaymentSelection({ ...base, lines: [{ ...base.lines[0], recipientKey: "SUPPLIER:other:bank" }] }), /cùng NCC/i);
  assert.throws(() => validateVendorPaymentSelection({ ...base, lines: [{ ...base.lines[0], fundingSource: "VENDOR_ADVANCE" }] }), /VENDOR_PAYMENT/);
  assert.throws(() => validateVendorPaymentSelection({ ...base, lines: [{ ...base.lines[0], sourceKind: "LEGACY_EXPENSE" }] }), /legacy Expense/i);
  assert.throws(() => validateVendorPaymentSelection({ ...base, lines: [base.lines[0], base.lines[0]], invoiceGross: "2200" }), /bị trùng/i);
});
