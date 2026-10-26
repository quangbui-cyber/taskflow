import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const source = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

test("round-trip dialog groups exact diff facts and requires explicit unchecked deletions", async () => {
  const dialog = await source("components/ExcelRoundTripDialog.tsx");
  assert.match(dialog, /Thêm mới/);
  assert.match(dialog, /Thay đổi/);
  assert.match(dialog, /Dòng có thể xóa/);
  assert.match(dialog, /Di chuyển/);
  assert.match(dialog, /oldValue/);
  assert.match(dialog, /newValue/);
  assert.match(dialog, /source\.cell/);
  assert.match(dialog, /selectedDeletionIds/);
  assert.match(dialog, /useState<string\[\]>\(\[\]\)/);
  assert.match(dialog, /Xác nhận xóa/);
  assert.match(dialog, /Chọn tất cả/);
  assert.match(dialog, /aggregateDeletionConfirmed/);
  assert.match(dialog, /Tiếp tục và bỏ lựa chọn/);
  assert.match(dialog, /Ở lại/);
  assert.match(dialog, /method:\s*"DELETE"/);
  assert.match(dialog, /Không còn áp dụng/);
  assert.match(dialog, /server draft changed|nháp trên máy chủ đã thay đổi/i);
});

test("editable paired worksheet alone exposes export and re-import controls", async () => {
  const editor = await source("components/PairedQuotationIcEditor.tsx");
  assert.match(editor, /ExcelRoundTripDialog/);
  assert.match(editor, /mode\s*===\s*"paired"[\s\S]*draftId[\s\S]*!locked/);
  assert.match(editor, /dirty/);
  assert.match(editor, /onApplied/);
  const css = await source("app/modules.css");
  assert.match(css, /tf-round-trip/);
  assert.match(css, /@media[\s\S]*max-width:\s*767px[\s\S]*tf-round-trip/);
});

test("round-trip action re-authenticates and delegates to serializable merge service", async () => {
  const action = await source("app/actions/costflowExcelIntake.ts");
  const service = await source("lib/costflow/excelIntakeService.ts");
  assert.match(action, /requireUser/);
  assert.match(action, /confirmRoundTripMerge/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /selectedDeletionIds/);
  assert.match(service, /previewFingerprint/);
  assert.match(service, /CONFIRM_EXCEL_ROUND_TRIP/);
});
