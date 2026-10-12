import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("paired UI contract: WorksheetGrid satisfies accessibility, caption, empty state and typography baseline", () => {
  const grid = source("components/costflow/paired/WorksheetGrid.tsx");

  // Caption & accessibility
  assert.match(grid, /<caption[^>]*>Bảng tính Báo giá và IC song song<\/caption>/);
  assert.match(grid, /aria-label="Chọn tất cả các dòng"/);
  assert.match(grid, /Chưa có hạng mục nào trong bảng tính/);

  // Icon accessibility
  assert.match(grid, /<ChevronRight[^>]*aria-hidden="true"/);
  assert.match(grid, /<ChevronDown[^>]*aria-hidden="true"/);
  assert.match(grid, /<Paperclip[^>]*aria-hidden="true"/);
  assert.match(grid, /<Settings2[^>]*aria-hidden="true"/);

  // Clean Vietnamese labels (no internal abbreviation)
  assert.match(grid, /Đã bỏ khỏi báo giá/);
  assert.doesNotMatch(grid, /Đã bỏ khỏi BG/);

  // Typography baseline (no arbitrary sub-12px classes)
  assert.doesNotMatch(grid, /text-\[10px\]|text-\[11px\]/);
});
test("paired UI contract: WorksheetDetailDrawer and Editor enforce destructive guards and professional copy", () => {
  const drawer = source("components/costflow/paired/WorksheetDetailDrawer.tsx");
  const editor = source("components/PairedQuotationIcEditor.tsx");

  // Confirmation guard before removing from quote
  assert.match(drawer, /window\.confirm\("Bạn có chắc chắn muốn bỏ dòng này khỏi báo giá\?"\)/);

  // Clean copy
  assert.match(drawer, /Chưa có minh chứng/);
  assert.doesNotMatch(drawer, /Chưa có nguồn/);
  assert.match(drawer, /Khôi phục dòng vào báo giá/);
  assert.doesNotMatch(drawer, /Khôi phục bán dòng này/);

  // Icon accessibility
  assert.match(drawer, /<Paperclip[^>]*aria-hidden="true"/);

  // Finalize confirmation guard in Editor
  assert.match(editor, /window\.confirm\("Bạn có chắc chắn muốn chốt phiên bản báo giá này\?/);
});

test("paired UI contract: CustomerQuotationView applies tabular numbers and table caption", () => {
  const customerView = source("components/CustomerQuotationView.tsx");

  assert.match(customerView, /<caption[^>]*>Hạng mục báo giá khách · VND<\/caption>/);
  assert.match(customerView, /tabular-nums/);
  assert.match(customerView, /font-mono/);
  assert.match(customerView, /scope="col"/);
  assert.match(customerView, /scope="row"/);
});

test("paired UI contract: modules.css adheres to 12px caption baseline and semantic CSS variables", () => {
  const css = source("app/modules.css");

  // Sub-12px styles eliminated in worksheet and paired rules
  assert.doesNotMatch(css, /\.tf-worksheet-outline-badge\s*\{[^}]*font-size:\s*1[01]px/);
  assert.doesNotMatch(css, /\.tf-worksheet-margin-badge\s*\{[^}]*font-size:\s*1[01]px/);
  assert.doesNotMatch(css, /\.tf-customer-group-count\s*\{[^}]*font-size:\s*1[01]px/);
  assert.doesNotMatch(css, /\.tf-quotation-lineage small\s*\{[^}]*font-size:\s*1[01]px/);
  assert.doesNotMatch(css, /\.tf-module-page \.tf-paired-workspace \.tf-quotation-hierarchy-table thead th\s*\{[^}]*font-size:\s*10px/);

  // Hardcoded hex colors replaced with CSS custom properties
  assert.doesNotMatch(css, /\.tf-customer-hierarchy-table \.tf-customer-group-row th\s*\{[^}]*#cfd8b6/);
  assert.doesNotMatch(css, /\.tf-customer-hierarchy-table \.tf-customer-group-row th\s*\{[^}]*#f4f8e9/);
  assert.match(css, /\.tf-customer-hierarchy-table \.tf-customer-group-row th\s*\{[^}]*var\(--border\)/);
  assert.match(css, /\.tf-customer-hierarchy-table \.tf-customer-group-row th\s*\{[^}]*var\(--primary-soft\)/);
});

test("paired UI contract: QuotationSettingsDrawer and QuotationTotalsEditor enforce polish and safeguards", () => {
  const settings = source("components/QuotationSettingsDrawer.tsx");
  const totals = source("components/QuotationTotalsEditor.tsx");
  const header = source("components/costflow/paired/WorksheetHeader.tsx");
  const saveBar = source("components/costflow/paired/WorksheetSaveBar.tsx");

  // QuotationSettingsDrawer
  assert.doesNotMatch(settings, /Wave 7 Auto-eval/);
  assert.match(settings, /Định giá theo tham số/);
  assert.doesNotMatch(settings, /text-\[10px\]|text-\[11px\]/);
  assert.match(settings, /<caption[^>]*>Chi tiết các dòng bị tác động bởi thay đổi tham số<\/caption>/);
  assert.match(settings, /tabular-nums/);

  // QuotationTotalsEditor delete guard
  assert.match(totals, /window\.confirm\(`Bạn có chắc chắn muốn xóa dòng/);

  // WorksheetHeader and WorksheetSaveBar clean copy
  assert.doesNotMatch(header, /Chốt phiên bản BG/);
  assert.match(header, /Chốt phiên bản báo giá/);
  assert.doesNotMatch(header, /Lập IC từ BG-/);
  assert.match(header, /Lập IC từ Báo giá #/);

  assert.doesNotMatch(saveBar, /Chốt phiên bản BG/);
  assert.match(saveBar, /Chốt phiên bản báo giá/);
});
