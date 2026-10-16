import test from "node:test";
import assert from "node:assert/strict";

import { appendSettlementLocks } from "../lib/costflow/settlementService.ts";
import { validateVendorPaymentSelection } from "../lib/costflow/vendorPaymentService.ts";
import { normalizeVendorPaymentSchedule } from "../lib/costflow/vendorPaymentSchedule.ts";

test("two projects can share one supplier while each normalized obligation is counted once", () => {
  const supplier = "SUPPLIER:shared:primary-bank";
  const projectA = validateVendorPaymentSelection({
    projectId: "project-a",
    recipientKey: supplier,
    invoiceGross: "1100",
    lines: [{ projectId: "project-a", stableLineId: "ac-a", versionId: "av-a", approvalId: "aa-a", approvalAttemptId: "attempt-a", fundingSource: "VENDOR_PAYMENT", recipientKey: supplier, approvedAmount: "1100", alreadyApplied: "0", amount: "1100", sourceKind: "IC_LINKED" }],
  });
  const projectB = validateVendorPaymentSelection({
    projectId: "project-b",
    recipientKey: supplier,
    invoiceGross: "2200",
    lines: [{ projectId: "project-b", stableLineId: "ac-b", versionId: "av-b", approvalId: "aa-b", approvalAttemptId: "attempt-b", fundingSource: "VENDOR_PAYMENT", recipientKey: supplier, approvedAmount: "2200", alreadyApplied: "0", amount: "2200", sourceKind: "IC_LINKED" }],
  });
  assert.equal(projectA.totalAmount, "1100");
  assert.equal(projectB.totalAmount, "2200");

  const locks = appendSettlementLocks({
    projectId: "project-a",
    dossierVersionId: "settlement-a",
    sourceManifest: {
      actualCosts: [{ projectId: "project-a", recipientKey: supplier, applicationId: "app-a", versionId: "av-a", approvalId: "aa-a" }],
      advanceAllocations: [],
    },
  });
  assert.equal(locks.locks.length, 1);
  assert.equal(locks.locks[0].actualCostApplicationId, "app-a");
  assert.throws(() => appendSettlementLocks({
    projectId: "project-a",
    dossierVersionId: "settlement-a",
    sourceManifest: {
      actualCosts: [
        { projectId: "project-a", recipientKey: supplier, applicationId: "app-a", versionId: "av-a", approvalId: "aa-a" },
        { projectId: "project-a", recipientKey: supplier, applicationId: "app-a", versionId: "av-a", approvalId: "aa-a" },
      ],
      advanceAllocations: [],
    },
  }), /trùng/i);
});

test("pre-AC supplier installment remains DNTU and legacy Expense cannot become post-AC DNTT", () => {
  const [installment] = normalizeVendorPaymentSchedule({
    revisionId: "ic-1",
    vendorId: "shared",
    lineAmounts: [{ lineId: "ic-line-1", amount: "3300" }],
    milestones: [{ id: "milestone-1", installmentNumber: 1, title: "Đặt cọc", percentage: 100, amount: "3300", dueDate: "2026-10-20", paymentMethod: "ADVANCE", lineAllocations: [{ lineId: "ic-line-1", amount: "3300" }] }],
  });
  assert.equal(installment.paymentMethod, "ADVANCE");
  assert.throws(() => validateVendorPaymentSelection({
    projectId: "project-a",
    recipientKey: "SUPPLIER:shared:primary-bank",
    invoiceGross: "3300",
    lines: [{ projectId: "project-a", stableLineId: "legacy", versionId: "legacy-v", approvalId: "legacy-a", approvalAttemptId: "legacy-attempt", fundingSource: "VENDOR_PAYMENT", recipientKey: "SUPPLIER:shared:primary-bank", approvedAmount: "3300", alreadyApplied: "0", amount: "3300", sourceKind: "LEGACY_EXPENSE" }],
  }), /legacy Expense/i);
});
