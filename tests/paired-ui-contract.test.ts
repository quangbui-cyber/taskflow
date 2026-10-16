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
  assert.equal(
    grid.match(/p-2 text-right font-bold text-\[var\(--foreground\)\]/g)?.length,
    4,
    "group and item sell/buy amounts should use the shared UI font with bold emphasis"
  );
  assert.doesNotMatch(grid, /text-right font-mono[^\n]*text-\[var\(--(?:foreground|color-brand-800|info)\)\]/);
  assert.doesNotMatch(grid, />\s*Tham số\s*<\/span>/);
  assert.doesNotMatch(grid, /hạng mục\s*<\/span>/);
  assert.doesNotMatch(grid, /Đã sửa tay|onReuseFormula|RotateCcw/);
  assert.match(grid, /usesParameterBinding \? "tf-worksheet-parameter-quantity"/);
});
test("paired UI contract: WorksheetDetailDrawer and Editor enforce destructive guards and professional copy", () => {
  const drawer = source("components/costflow/paired/WorksheetDetailDrawer.tsx");
  const editor = source("components/PairedQuotationIcEditor.tsx");

  // Confirmation guard before removing from quote
  assert.match(drawer, /window\.confirm\("Bạn có chắc chắn muốn bỏ dòng này khỏi báo giá\?"\)/);
  assert.match(drawer, /onRequestDelete\(detail\.itemId\)/);
  assert.match(drawer, />\s*Xóa hẳn\s*<\/Button>/);
  assert.match(editor, /title="Xóa hẳn hạng mục\?"/);
  assert.match(editor, /Xóa hẳn \$\{deleteBranch\.length\} dòng/);
  assert.match(editor, /orderedRows\(rows, deleteTargetId\)/);
  assert.match(editor, /current\.filter\(row => !removedIds\.has\(row\.itemId\)\)/);
  assert.match(editor, /Báo giá nguồn, chứng từ và lịch sử tài chính đã phát sinh vẫn được hệ thống bảo toàn/);

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
  assert.match(css, /\.tf-paired-workspace \.tf-paired-table \.tf-worksheet-parameter-quantity\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/);
});

test("paired UI contract: save bar stays on one row on wide desktop and remains responsive on mobile", () => {
  const css = source("app/modules.css");

  assert.match(css, /@media \(min-width:1360px\)\s*\{[\s\S]*?\.tf-workspace-paired \.tf-paired-save-bar\s*\{[^}]*display:flex;[^}]*flex-wrap:nowrap;/);
  assert.match(css, /@media \(min-width:1360px\)\s*\{[\s\S]*?\.tf-workspace-paired \.tf-paired-save-bar\s*\{[^}]*overflow:visible;/);
  assert.match(css, /@media \(min-width:1360px\)\s*\{[\s\S]*?\.tf-workspace-paired \.tf-paired-totals\s*\{[^}]*min-width:0;[^}]*overflow-x:auto;/);
  assert.match(css, /@media \(min-width:1360px\)\s*\{[\s\S]*?\.tf-workspace-paired \.tf-paired-save-actions\s*\{[^}]*width:auto;[^}]*flex-wrap:nowrap;[^}]*border-top:0;/);
  assert.doesNotMatch(css, /\.tf-paired-save-scope-group/);
  assert.match(css, /\.tf-paired-split-save\s*\{[^}]*display:flex;/);
  assert.match(css, /@media \(max-width:640px\)\s*\{[\s\S]*?\.tf-workspace-paired \.tf-paired-save-buttons\s*\{[^}]*display:grid;[^}]*width:100%;/);
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

test("paired UI contract: save choices live in the split-button menu and obsolete review controls are removed", () => {
  const editor = source("components/PairedQuotationIcEditor.tsx");
  const saveBar = source("components/costflow/paired/WorksheetSaveBar.tsx");
  const service = source("lib/costflow/pairedService.ts");

  assert.match(saveBar, /aria-haspopup="menu"/);
  assert.match(saveBar, /runSave\("BOTH"\)/);
  assert.match(saveBar, /runSave\("QUOTE"\)/);
  assert.match(saveBar, /runSave\("IC"\)/);
  assert.match(saveBar, /Chỉ lưu Báo giá/);
  assert.match(saveBar, /Chỉ lưu IC/);
  assert.doesNotMatch(saveBar, /Đã lưu|Đã rà giá|save-scope|priceReview/);
  assert.doesNotMatch(editor, /priceReviewRequired|priceReviewConfirmed|priceReviewed/);
  assert.doesNotMatch(editor, /QuotationIcLineage|reuseFormula|mode: "OVERRIDDEN"/);
  assert.match(editor, /roundTripAction=/);
  assert.doesNotMatch(service, /priceReviewRequired|priceReviewConfirmed/);
});

test("paired UI contract: successful saves use a centered dialog instead of an inline save-bar alert", () => {
  const saveBar = source("components/costflow/paired/WorksheetSaveBar.tsx");

  assert.match(saveBar, /import \{ Dialog \} from "@\/components\/ui\/Dialog"/);
  assert.match(saveBar, /open=\{!!state\.success\}/);
  assert.match(saveBar, /onClose=\{onDismissSuccess\}/);
  assert.match(saveBar, /title=\{state\.success \?\? "Lưu thành công"\}/);
  assert.match(saveBar, /Mở Internal Cost/);
  assert.match(saveBar, /Mở hồ sơ IC/);
  assert.doesNotMatch(saveBar, /<Alert tone="success"/);
});

test("scope quotation drafts expose an owner-scoped delete confirmation", () => {
  const panel = source("components/QuotationPanel.tsx");
  const service = source("lib/costflow/service.ts");

  assert.match(panel, /title="Xóa bản nháp\?"/);
  assert.match(panel, /name="command" value="DELETE_QUOTATION_DRAFT"/);
  assert.match(panel, /Chỉ workspace nháp đang soạn bị xóa/);
  assert.match(panel, /loadingLabel="Đang xóa…"/);
  assert.match(service, /case "DELETE_QUOTATION_DRAFT"/);
  assert.match(service, /deleteOwnedQuotationDraft\(data, requireValue\(text\(form, "draftId"\), "bản nháp"\), actor\.id\)/);
});

test("paired UI contract: supplier reference files are optional pending accountant verification", () => {
  const editor = source("components/PairedQuotationIcEditor.tsx");
  assert.match(editor, /File tham chiếu NCC đã có \(không bắt buộc\)/);
  assert.match(editor, /Hoặc tải file tham chiếu mới \(không bắt buộc\)/);
  assert.doesNotMatch(editor, /Dùng tài liệu đã có trong project|tài liệu căn cứ mới/);
});
