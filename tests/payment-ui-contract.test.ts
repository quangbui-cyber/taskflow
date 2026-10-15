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
  assert.match(settlement, /AC đã duyệt/);
  assert.match(settlement, /Hoàn IN hoặc chi thêm OUT đúng phần chênh lệch/);
  assert.match(settlement, /duyệt hồ sơ và cash vẫn là các trục riêng/);
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

test("payment UI: reviewer exposes immutable facts and Project-scoped evidence routes", () => {
  const review = source("components/costflow/payments/PaymentRequestReview.tsx");
  const discussion = source("components/costflow/payments/PaymentLineDiscussion.tsx");

  for (const fact of ["Snapshot server bất biến", "Mốc hồ sơ chung", "Tổng server", "Tài liệu trong snapshot", "Thay đổi so với bản nguồn", "Giải trình của hồ sơ"]) {
    assert.match(review, new RegExp(fact));
  }
  assert.match(review, /\/api\/projects\/\$\{finance\.project\.id\}\/costflow\/evidence\/\$\{document\.id\}/);
  assert.match(review, /evidence\/\$\{document\.id\}\/preview/);
  assert.match(discussion, /ADD_PAYMENT_LINE_DISCUSSION/);
  assert.doesNotMatch(review, /command="DECIDE"|APPROVE_PAYMENT|Duyệt khoản|Từ chối khoản/);
});

test("payment UI: ledger has complete desktop and mobile state axes", () => {
  const ledger = source("components/costflow/payments/PaymentLedgerTable.tsx");
  const css = source("app/modules.css");

  assert.match(ledger, /tf-payment-ledger-table/);
  assert.match(ledger, /tf-payment-ledger-cards/);
  for (const fact of ["Duyệt:", "Tiền:", "Xác minh NCC:", "Đóng tài chính:", "Gross tạm ứng OUT", "Hoàn IN", "Chi thêm OUT", "Nguồn AC"]) {
    assert.match(ledger, new RegExp(fact));
  }
  assert.match(ledger, /evidence\/\$\{link\.id\}\/preview/);
  assert.match(css, /\.tf-payment-ledger-table[\s\S]*display: none/);
});

test("payment UI: workspace keeps shared approval and money surfaces distinct", () => {
  const workspace = source("components/CostFlowPanel.tsx");
  const approval = source("components/ApprovalRequestsPanel.tsx");
  const css = source("app/modules.css");

  assert.match(workspace, /ApprovalRequestsPanel/);
  assert.match(workspace, /SettlementPanel/);
  assert.match(workspace, /Hồ sơ & Trình duyệt/);
  assert.match(workspace, /Tiền & Quyết toán/);
  assert.match(approval, /AdvanceSettlementAllocator/);
  assert.doesNotMatch(approval, /duyệt ngoại lệ/i);
  assert.doesNotMatch(`${workspace}\n${approval}`, /PAY-06/);
  assert.doesNotMatch(workspace, /PaymentCashPanel/);
  assert.doesNotMatch(approval, /PRE_APPROVAL|APPROVE_EXCEPTION|chi trước/i);
  assert.match(approval, /className="tf-dialog-wide tf-approval-inspection-modal"/);
  assert.doesNotMatch(approval, /Trục 1: Hiệu lực ngân sách|Trục 2: Kết quả trình duyệt|Trạng thái IC-R/);
  assert.match(css, /dialog\.tf-ui-dialog\.tf-approval-inspection-modal\[open\][\s\S]*inset: 0;[\s\S]*margin: auto;[\s\S]*width: min\(1120px, calc\(100vw - 48px\)\)/);
  assert.doesNotMatch(css, /:has\(\.tf-ic-evidence-panel\)/);
  assert.match(css, /:has\(> \.my-5 > \.tf-ic-evidence-panel\)/);
});

test("IC approval modal leads with financial review, coverage and compact responsive rows", () => {
  const approval = source("components/ApprovalRequestsPanel.tsx");
  const review = source("components/IcApprovalReviewDashboard.tsx");
  const projection = source("lib/costflow/icApprovalReview.ts");
  const css = source("app/modules.css");

  assert.match(approval, /IcApprovalReviewDashboard/);
  assert.match(approval, /tf-approval-sticky-actionbar/);
  assert.match(approval, /request-decision-/);
  for (const fact of ["Báo giá Net", "Tổng IC Net", "Biên dự kiến", "Minh chứng file", "Nhà cung cấp"]) {
    assert.match(review, new RegExp(fact));
  }
  assert.match(review, /Cảnh báo hỗ trợ thẩm định/);
  assert.match(review, /tf-ic-review-table/);
  assert.match(review, /tf-ic-review-cards/);
  assert.match(projection, /projectQuotation/);
  assert.match(projection, /calculateMargin/);
  assert.doesNotMatch(review, /Margin thực tế/);
  assert.match(css, /\.tf-ic-review-table[\s\S]*min-width:930px/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.tf-ic-review-table \{ display:none; \}[\s\S]*\.tf-ic-review-cards \{ display:grid/);
});
