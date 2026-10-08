import test from "node:test";
import assert from "node:assert/strict";
import { projectPaymentLedger } from "../lib/costflow/paymentReadModel";

const normalized = [{
  requestId: "request-a",
  projectId: "project-a",
  kind: "ADVANCE",
  title: "ĐNTU đa người nhận",
  milestone: "Đợt chuẩn bị",
  approvalState: "APPROVED",
  recipients: [
    { recipientKey: "VENDOR:a", recipientType: "VENDOR", displayName: "Vendor A", totalAmount: "25000000", beneficiaryVerification: "VERIFIED" as const },
    { recipientKey: "USER:b", recipientType: "EMPLOYEE", displayName: "Nhân viên B", totalAmount: "10000000", beneficiaryVerification: "NOT_APPLICABLE" as const },
  ],
  lines: [
    { id: "line-a", recipientKey: "VENDOR:a", amount: "25000000" },
    { id: "line-b", recipientKey: "USER:b", amount: "10000000" },
  ],
}];

test("payment-read-model: normalized rows win, recipients remain separate and axes do not collapse", () => {
  const rows = projectPaymentLedger({
    normalized,
    legacy: [
      { id: "request-a", projectId: "project-a", kind: "ADVANCE", title: "duplicate", state: "APPROVED", payload: { amount: "999", recipientKey: "VENDOR:a" } },
      { id: "legacy-only", projectId: "project-a", kind: "ADVANCE", title: "Legacy", state: "APPROVED", payload: { amount: "5000000", recipientKey: "USER:legacy", milestone: "Old" } },
    ],
    cash: [
      { id: "cash-a", projectId: "project-a", requestId: "request-a", recipientKey: "VENDOR:a", direction: "OUT", amount: "25000000", evidenceId: "proof-a", normalizedAllocations: [{ requestLineId: "line-a", amount: "25000000", direction: "OUT" }] },
      { id: "cash-b", projectId: "project-a", requestId: "request-a", recipientKey: "USER:b", direction: "OUT", amount: "4000000", evidenceId: "proof-b", normalizedAllocations: [{ requestLineId: "line-b", amount: "4000000", direction: "OUT" }] },
    ],
    financialCloseState: "OPEN",
  });

  assert.equal(rows.length, 3);
  assert.equal(rows.filter(row => row.requestId === "request-a").length, 2);
  const vendor = rows.find(row => row.recipientKey === "VENDOR:a")!;
  assert.deepEqual({ approved: vendor.approvedAmount, paid: vendor.grossStandardOut, remaining: vendor.remainingStandardOut }, { approved: "25000000", paid: "25000000", remaining: "0" });
  assert.equal(vendor.cashProgress, "DA_CHI_DU");
  assert.equal(vendor.approvalState, "APPROVED");
  assert.equal(vendor.financialCloseState, "OPEN");
  assert.equal(vendor.approvedAcSourceStatus, "UNAVAILABLE");
  assert.equal(vendor.additionalOutBalance, null);
  assert.equal(vendor.refundInBalance, null);
  assert.equal("bankName" in vendor, false);
  assert.equal("accountNumber" in vendor, false);
  assert.deepEqual(vendor.evidenceLinks, [{ id: "proof-a", label: "Chứng từ giao dịch" }]);

  const employee = rows.find(row => row.recipientKey === "USER:b")!;
  assert.equal(employee.grossStandardOut, "4000000");
  assert.equal(employee.remainingStandardOut, "6000000");
  assert.equal(employee.cashProgress, "DANG_CHI_MOT_PHAN");
  const legacy = rows.find(row => row.requestId === "legacy-only")!;
  assert.equal(legacy.provenance, "legacy");
  assert.equal(legacy.needsReview, true);
  assert.equal(legacy.grossStandardOut, null);
});

test("payment-read-model: project, request, recipient and flow boundaries prevent global consumption", () => {
  const rows = projectPaymentLedger({
    normalized: [
      ...normalized,
      { ...normalized[0], requestId: "request-b", projectId: "project-b", title: "Project B", recipients: [{ ...normalized[0].recipients[1], totalAmount: "7000000" }], lines: [{ id: "line-project-b", recipientKey: "USER:b", amount: "7000000" }] },
    ],
    legacy: [],
    cash: [
      { id: "valid", projectId: "project-a", requestId: "request-a", recipientKey: "USER:b", direction: "OUT", amount: "4000000", evidenceId: "proof", normalizedAllocations: [{ requestLineId: "line-b", amount: "4000000", direction: "OUT" }] },
      { id: "other-project", projectId: "project-b", requestId: "request-b", recipientKey: "USER:b", direction: "OUT", amount: "7000000", evidenceId: "proof-b", normalizedAllocations: [{ requestLineId: "line-project-b", amount: "7000000", direction: "OUT" }] },
      { id: "wrong-line", projectId: "project-a", requestId: "request-a", recipientKey: "USER:b", direction: "OUT", amount: "1000000", evidenceId: "proof-x", normalizedAllocations: [{ requestLineId: "line-project-b", amount: "1000000", direction: "OUT" }] },
    ],
    financialCloseState: "CLOSED",
  });
  const a = rows.find(row => row.projectId === "project-a" && row.recipientKey === "USER:b")!;
  const b = rows.find(row => row.projectId === "project-b" && row.recipientKey === "USER:b")!;
  assert.equal(a.grossStandardOut, "4000000");
  assert.equal(b.grossStandardOut, "7000000");
  assert.equal(a.financialCloseState, "CLOSED");
  assert.equal(a.cashProgress, "DANG_CHI_MOT_PHAN");
});
