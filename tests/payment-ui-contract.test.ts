import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("payment UI: editor preserves the complete desktop and mobile line contract", () => {
  const editor = source("components/costflow/payments/PaymentRequestEditor.tsx");
  const css = source("app/modules.css");

  assert.match(editor, /tf-payment-line-table/);
  assert.match(editor, /tf-payment-line-cards/);
  for (const fact of ["Dòng IC hiệu lực", "Người nhận", "Số tiền VND", "Nhân đôi khoản", "Xóa khoản", "Thêm khoản"]) {
    assert.match(editor, new RegExp(fact));
  }
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.tf-payment-line-table[\s\S]*display: none/);
  assert.match(css, /\.tf-payment-line-cards,[\s\S]*display: block/);
});

test("payment UI: preview is an explicit dialog and remains server-authoritative", () => {
  const editor = source("components/costflow/payments/PaymentRequestEditor.tsx");
  const preview = source("components/costflow/payments/PaymentRequestPreview.tsx");

  assert.match(editor, /<Dialog[\s\S]*Xem trước hồ sơ gửi duyệt/);
  assert.match(editor, /server sẽ chuẩn hóa và tính lại trước khi lưu snapshot bất biến/);
  assert.match(preview, /Một mốc chung/);
  assert.match(preview, /Tổng đề nghị/);
  assert.match(preview, /Tổng theo người nhận/);
  assert.match(preview, /tài liệu riêng lẻ không phải bằng chứng AC đã duyệt/);
  assert.doesNotMatch(editor, /lineMilestone|milestoneByLine|Mốc khoản/i);
});

test("payment UI: cash and post-AC meanings stay separate and fail closed", () => {
  const cash = source("components/costflow/payments/CashConfirmationEditor.tsx");
  const settlement = source("components/costflow/payments/AdvanceSettlementAllocator.tsx");

  assert.match(cash, /Gross tạm ứng OUT/);
  assert.match(cash, /một người nhận/);
  assert.match(cash, /Hoàn IN, chi thêm OUT, net cash, approved actual và đóng tài chính/);
  assert.match(settlement, /Approved AC producer unavailable until Phase 8/);
  assert.match(settlement, /không FIFO/);
  assert.doesNotMatch(settlement, /command=/);
});

test("payment UI: no Phase 7 exception approval or evidence-as-AC control is introduced", () => {
  const files = [
    "components/costflow/payments/PaymentRequestEditor.tsx",
    "components/costflow/payments/PaymentRequestPreview.tsx",
    "components/costflow/payments/CashConfirmationEditor.tsx",
    "components/costflow/payments/AdvanceSettlementAllocator.tsx",
  ].map(source).join("\n");

  assert.doesNotMatch(files, /PAY-06/);
  assert.doesNotMatch(files, /duyệt ngoại lệ/i);
  assert.doesNotMatch(files, /evidence.*approved AC/i);
});
