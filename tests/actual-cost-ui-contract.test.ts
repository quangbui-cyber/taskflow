import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("actual cost UI: editor keeps authority, evidence and cash as distinct axes", () => {
  const editor = source("components/costflow/actual-cost/ActualCostEditor.tsx");
  const decisions = source("components/costflow/actual-cost/ActualCostDecisionBar.tsx");

  for (const fact of ["EMPLOYEE_ADVANCE", "EMPLOYEE_OUT_OF_POCKET", "VENDOR_ADVANCE", "VENDOR_PAYMENT"]) {
    assert.match(editor, new RegExp(fact));
  }
  assert.match(editor, /quantity/);
  assert.match(editor, /days/);
  assert.match(editor, /unitPrice/);
  assert.match(editor, /legacy\/needsReview/);
  assert.match(decisions, /AC_DD/);
  assert.match(decisions, /APPROVED/);
  assert.match(decisions, /RETURNED/);
  assert.match(decisions, /Lý do trả lại/);
  assert.doesNotMatch(`${editor}\n${decisions}`, /CREATE_CASH|CONFIRM_CASH|evidence.*APPROVED/i);
});

test("actual cost UI: server action receives identifiers and raw inputs only", () => {
  const action = source("app/actions/costflow.ts");
  const service = source("lib/costflow/actualCostService.ts");

  assert.match(action, /actualCostAction/);
  assert.match(service, /AC_DD/);
  assert.match(service, /APPROVED/);
  assert.match(service, /RETURNED/);
  assert.doesNotMatch(action, /trustedApprovedAmount|clientApprovedAmount/);
});

test("actual cost UI: comparison table keeps mixed units separate and totals VND only", () => {
  const table = source("components/costflow/actual-cost/ActualCostTable.tsx");
  const editor = source("components/costflow/actual-cost/ActualCostEditor.tsx");
  for (const label of ["SL", "Ngày", "Đơn giá", "Thành tiền", "Tiết kiệm", "Vượt ngân sách", "Tổng NET", "Tổng VAT", "Tổng GROSS"]) {
    assert.match(table, new RegExp(label));
  }
  assert.doesNotMatch(table, /Tổng số lượng|totalQuantity/);
  assert.match(table, /line\.unit/);
  assert.match(editor, /\[Phát sinh ngoài IC\]/);
  assert.match(editor, /Thu thêm từ khách/);
  assert.match(editor, /Cần ít nhất một chứng từ/);
});

test("actual cost UI: evidence vault exposes five typed kinds and explicit DD acknowledgement", () => {
  const vault = source("components/costflow/actual-cost/ActualCostEvidenceVault.tsx");
  const decisions = source("components/costflow/actual-cost/ActualCostDecisionBar.tsx");
  for (const kind of ["VENDOR_CONTRACT_PO", "ACCEPTANCE_HANDOVER", "VAT_INVOICE", "PAYMENT_PROOF", "FIELD_PHOTO_REPORT"]) {
    assert.match(vault, new RegExp(kind));
  }
  for (const fact of ["sha256", "createdAt", "createdByName", "preview", "Tải xuống"]) assert.match(vault, new RegExp(fact));
  assert.match(decisions, /reviewToken/);
  assert.match(decisions, /acknowledgeMissingEvidence/);
  assert.match(decisions, /Tôi xác nhận duyệt dù còn thiếu chứng từ/);
});
