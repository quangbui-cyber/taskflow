import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("actual cost UI: editor keeps authority, evidence and cash as distinct axes", () => {
  const editor = source("components/costflow/actual-cost/ActualCostDetailDrawer.tsx");
  const decisions = source("components/costflow/actual-cost/ActualCostDecisionBar.tsx");

  for (const fact of ["EMPLOYEE_ADVANCE", "EMPLOYEE_OUT_OF_POCKET", "VENDOR_ADVANCE", "VENDOR_PAYMENT"]) {
    assert.match(editor, new RegExp(fact));
  }
  assert.match(editor, /quantity/);
  assert.match(editor, /days/);
  assert.match(editor, /unitPrice/);
  assert.match(editor, /SAVE_LINE/);
  assert.match(decisions, /Phó Giám đốc/);
  assert.match(decisions, /Duyệt toàn bộ Bảng AC/);
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
  const table = source("components/costflow/actual-cost/ActualCostSheetView.tsx");
  const editor = source("components/costflow/actual-cost/ActualCostDetailDrawer.tsx");
  for (const label of ["SL", "Ngày", "Đơn giá", "Thành tiền", "Vượt ngân sách", "NET:", "VAT:", "GROSS"]) {
    assert.match(table, new RegExp(label));
  }
  assert.doesNotMatch(table, /Tổng số lượng|totalQuantity/);
  assert.match(table, /l\.unit/);
  assert.match(editor, /\[Phát sinh ngoài IC\]/);
  assert.match(editor, /Thu thêm từ khách/);
  assert.match(editor, /Chứng từ nghiệm thu/);
});

test("actual cost UI: evidence vault exposes five typed kinds and explicit DD acknowledgement", () => {
  const vault = source("components/costflow/actual-cost/ActualCostEvidenceVault.tsx");
  const decisions = source("components/costflow/actual-cost/ActualCostDecisionBar.tsx");
  for (const kind of ["VENDOR_CONTRACT_PO", "ACCEPTANCE_HANDOVER", "VAT_INVOICE", "PAYMENT_PROOF", "FIELD_PHOTO_REPORT"]) {
    assert.match(vault, new RegExp(kind));
  }
  for (const fact of ["sha256", "createdAt", "createdByName", "preview", "Tải xuống"]) assert.match(vault, new RegExp(fact));
  assert.match(decisions, /manifestHash/);
  assert.match(decisions, /sheetRevisionId/);
  assert.match(decisions, /acknowledgeMissingEvidence/);
  assert.match(decisions, /xác nhận duyệt Bảng AC dù còn thiếu chứng từ/);
});

test("customer acceptance UI keeps sales actuals and billable additions explicit", () => {
  const component = source("components/costflow/customer/CustomerAcceptanceExport.tsx");
  const panel = source("components/CostFlowPanel.tsx");
  for (const fact of ["actualRows", "quantity", "days", "selectedActualCostVersionIds", "UNBUDGETED", "billable", "reviewState === \"approved\""]) {
    assert.match(component, new RegExp(fact));
  }
  assert.match(component, /type="checkbox"/);
  assert.doesNotMatch(component, /defaultChecked/);
  assert.match(component, /customer-acceptance\/pdf/);
  assert.match(component, /customer-acceptance\/xlsx/);
  assert.match(panel, /CustomerAcceptanceExport/);
});

test("actual cost operational UI keeps desktop, 390px mobile and atomic DD bulk controls", () => {
  const table = source("components/costflow/actual-cost/ActualCostSheetView.tsx");
  const editor = source("components/costflow/actual-cost/ActualCostDetailDrawer.tsx");
  const panel = source("components/ActualCostPanel.tsx");
  const decision = source("components/costflow/actual-cost/ActualCostDecisionBar.tsx");
  const css = source("app/modules.css");
  for (const label of ["Chờ Account kiểm tra", "Account đã kiểm tra", "Cần bổ sung chứng từ", "Vượt ngân sách IC"]) assert.match(table, new RegExp(label));
  for (const field of ["SL × Ngày", "Đơn giá", "Chênh lệch IC", "Nguồn tiền", "Chứng từ", "Chi tiết"]) assert.match(table, new RegExp(field));
  assert.match(table, /<table/);
  assert.match(table, /<th/);
  assert.match(table, /UPDATE_LINES_STATUS/);
  assert.doesNotMatch(`${table}\n${editor}`, /BULK_DECIDE|bulkSelection|DECIDE\"/);
  assert.match(panel, /sheet\.state === "SUBMITTED"/);
  assert.match(decision, /Duyệt toàn bộ Bảng AC/);
  assert.match(css, /\.tf-ac-desktop/);
  assert.match(css, /\.tf-ac-mobile/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(table, /Tổng số lượng/);
});

test("customer accounting UI labels AR, AC, margin and cash axes separately at mobile", () => {
  const liquidation = source("components/costflow/customer/CustomerLiquidationPanel.tsx");
  const acceptance = source("components/costflow/customer/CustomerAcceptanceExport.tsx");
  const css = source("app/modules.css");
  for (const label of ["Doanh thu Net thanh lý", "Đã thu từ khách", "Khách còn nợ", "AC Net phát sinh", "Margin thực tế"]) assert.match(liquidation, new RegExp(label));
  assert.match(liquidation, /AR cash-in · gross, không phải tiền chi/);
  assert.match(liquidation, /Chế độ chỉ đọc/);
  assert.match(acceptance, /Mặc định không chọn/);
  assert.match(acceptance, /snapshotId=/);
  assert.match(css, /\.tf-customer-accounting-grid/);
  assert.match(css, /grid-template-columns: minmax\(0,1fr\)/);
  assert.match(css, /@media \(pointer: coarse\)/);
});

test("actual cost control center exposes the complete IC-AC worksheet and four capability lenses", () => {
  const center = source("components/costflow/actual-cost/ActualCostControlCenter.tsx");
  const worksheet = source("components/costflow/actual-cost/IcAcReconciliationWorksheet.tsx");
  const roleViews = source("components/costflow/actual-cost/ActualCostRoleViews.tsx");
  const css = source("app/modules.css");
  for (const label of ["Theo loại chi phí / dòng IC", "Của tôi", "Theo NCC", "Bất thường & kiểm toán"]) assert.match(center, new RegExp(label));
  for (const label of ["SL", "Ngày", "ĐVT", "Đơn giá", "NET / VAT / GROSS", "Chênh lệch", "Duyệt · chứng từ · tiền", "\\[Phát sinh ngoài IC\\]"]) assert.match(worksheet, new RegExp(label));
  for (const label of ["Tạm ứng đã nhận", "Tự chi", "Đã hoàn/chi thêm", "Công ty còn phải trả", "Đã đề nghị", "Đã chi", "Còn chờ chi"]) assert.match(roleViews, new RegExp(label));
  assert.match(worksheet, /group\.occurrences\.map/);
  assert.doesNotMatch(worksheet, /Tổng số lượng/);
  assert.match(css, /\.tf-ac-control-table/);
  assert.match(css, /\.tf-ac-control-mobile/);
  assert.match(css, /min-height: 44px/);
});

test("costflow visual polish hides redundant captions and keeps accessible table names", () => {
  const presentation = source("components/ui/Presentation.tsx");
  const overview = source("components/CostFlowPanel.tsx");
  const internal = source("components/InternalCostPanel.tsx");
  const worksheet = source("components/costflow/actual-cost/IcAcReconciliationWorksheet.tsx");
  const actualCost = source("components/ActualCostPanel.tsx");
  const css = source("app/modules.css");

  assert.match(presentation, /hideCaption/);
  assert.match(presentation, /aria-label=\{caption\}/);
  assert.match(overview, /caption="Các hồ sơ cập nhật gần đây" hideCaption className="tf-overview-request-table"/);
  assert.match(css, /\.tf-overview-request-table thead th \{ background: var\(--primary\)/);
  assert.match(internal, /Internal Cost & Ngân sách dự toán/);
  assert.doesNotMatch(internal, /<Layers3 size=\{22\}/);
  assert.doesNotMatch(internal, /Các dòng hạng mục IC-R\{visibleRevision\.number\}/);
  assert.match(internal, /caption=\{`Các dòng chi phí và NCC[^`]+`\} hideCaption/);
  assert.match(worksheet, /caption="Đối chiếu IC và thực chi AC theo từng lần phát sinh" hideCaption/);
  assert.match(actualCost, /className="tf-ac-policy"/);
  assert.match(actualCost, /phê duyệt AC và giải ngân vẫn là hai bước riêng/);
  assert.match(css, /\.tf-ac-policy-grid/);
});
