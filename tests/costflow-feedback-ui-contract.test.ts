import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("CostFlow creation CTAs open the paired quotation and IC workspace directly", () => {
  const panel = source("components/CostFlowPanel.tsx");
  const quotation = source("components/QuotationPanel.tsx");
  const banner = source("components/costflow/navigation/CostFlowActionBanner.tsx");

  assert.match(panel, /Tạo Báo giá &amp; IC mới/);
  assert.match(quotation, /pairedWorkspaceHref[\s\S]*Tạo Báo giá &amp; IC mới/);
  assert.match(banner, /label: "Tạo Báo giá & IC"[\s\S]*href: worksheetHref/);
  assert.doesNotMatch(panel, /Tạo báo giá mới/);
  assert.doesNotMatch(quotation, /Tạo báo giá mới|Tạo báo giá đầu tiên/);
});

test("all new quotation starts default to paired while legacy quote drafts remain resumable", () => {
  const chooser = source("components/QuotationSourceChooser.tsx");
  const quoteRoute = source("app/projects/[id]/costflow/quotations/new/page.tsx");
  const saveBar = source("components/costflow/paired/WorksheetSaveBar.tsx");

  assert.match(chooser, /form\.set\("workspaceMode", "paired"\)/);
  assert.match(chooser, /router\.push\(`\/projects\/\$\{projectId\}\/costflow\/paired\?draftId=/);
  assert.doesNotMatch(chooser, /create\(item, "quote"\)|Tạo Báo giá độc lập|>Tạo báo giá<|>Tạo Báo giá<\/Link>/);
  assert.match(quoteRoute, /if \(!draftId && \(quotationId \|\| start === "blank"\)\)[\s\S]*redirect\(`\/projects\/\$\{id\}\/costflow\/paired/);
  assert.match(quoteRoute, /draft\.workspaceMode \?\? "paired"\) === "quote"/, "Old quote-only drafts must still be resumable");
  assert.match(saveBar, /mode === "quote" \|\| locked \? "QUOTE" : mode === "ic" \? "IC" : "BOTH"/, "Paired save must default to BOTH");
});

test("CostFlow removes the requested duplicate status and urgent filter UI", () => {
  const lifecycle = source("components/costflow/navigation/FinancialLifecycleBar.tsx");
  const internalCost = source("components/InternalCostPanel.tsx");
  const schedule = source("components/VendorPaymentScheduleTable.tsx");

  assert.doesNotMatch(lifecycle, /Giai đoạn hiện tại/);
  assert.doesNotMatch(internalCost, /Đang xử lý revision/);
  assert.doesNotMatch(schedule, /Chỉ hiện đợt cần chi gấp|filterUrgentOnly/);
});

test("Excel intake explains resuming sessions and keeps clear sticky actions", () => {
  const dialog = source("components/ExcelIntakeDialog.tsx");
  const styles = source("app/modules.css");

  assert.match(dialog, /Xem trước dữ liệu/);
  assert.match(dialog, /Tạo nháp Báo giá &amp; IC/);
  assert.match(dialog, /Mở lại phiên xem trước/);
  assert.match(dialog, /Dán mã phiên đã lưu để tiếp tục sửa hoặc xem lại dữ liệu trước đó/);
  assert.doesNotMatch(dialog, /Cập nhật xem trước|Mã phiên xem trước/);
  assert.match(styles, /\.excel-intake-dialog > \.tf-ui-actions \{ position: sticky; bottom: 0/);
});

test("IC drawer keeps required validation without verbose suffix and uses the normal UI font", () => {
  const editor = source("components/EditIcLineModal.tsx");
  const fields = source("components/ui/Field.tsx");

  assert.match(fields, /hideRequiredText/);
  assert.equal((editor.match(/hideRequiredText/g) ?? []).length, 5);
  assert.match(editor, /required\s+hideRequiredText/);
  assert.match(editor, /flex flex-wrap items-center gap-3 tabular-nums/);
  assert.doesNotMatch(editor, /flex flex-wrap items-center gap-3 font-mono/);
});

test("paired worksheet header omits its redundant mode eyebrow", () => {
  const header = source("components/costflow/paired/WorksheetHeader.tsx");

  assert.match(header, /mode !== "paired"/);
  assert.doesNotMatch(header, /Báo giá & IC song song/);
});
