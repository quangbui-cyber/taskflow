import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { excelIntakeReducer, initialExcelIntakeState } from "../components/ExcelIntakeDialog";

test("Excel intake dialog exposes both sources, exact issue focus and Foundation primitives", async () => {
  const source = await readFile(path.join(process.cwd(), "components/ExcelIntakeDialog.tsx"), "utf8");
  for (const label of ["Dán bảng", "Tải XLSX", "Sheet", "Vùng dữ liệu", "Lỗi cần sửa", "Cảnh báo", "Sheet · dòng · ô", "Tạo nháp mới"]) assert.ok(source.includes(label), label);
  for (const primitive of ["Dialog", "Field", "Alert", "Table", "Button"]) assert.match(source, new RegExp(`\\b${primitive}\\b`));
  assert.match(source, /excel-intake-row-/);
  assert.match(source, /aria-live/);
  assert.match(source, /disabled=[\s\S]*blocking|blocking[\s\S]*disabled/);
});

test("reducer preserves raw cells and corrections across stale or failed responses", () => {
  const source = { ...initialExcelIntakeState, open: true, paste: "A\tB", requestId: 2, corrections: { "candidate-1.sell.quantity": "3" } };
  const stale = excelIntakeReducer(source, { type: "PREVIEW_OK", requestId: 1, preview: null });
  assert.deepEqual(stale, source);
  const failed = excelIntakeReducer(source, { type: "REQUEST_FAILED", requestId: 2, message: "Lỗi mạng" });
  assert.equal(failed.paste, "A\tB");
  assert.equal(failed.corrections["candidate-1.sell.quantity"], "3");
  assert.equal(failed.error, "Lỗi mạng");
});

test("quotation panel opens the creator-only intake dialog and customer view remains private", async () => {
  const panel = await readFile(path.join(process.cwd(), "components/QuotationPanel.tsx"), "utf8");
  assert.match(panel, /canCreate[\s\S]*ExcelIntakeDialog/);
  const customer = await readFile(path.join(process.cwd(), "components/CustomerQuotationView.tsx"), "utf8");
  assert.doesNotMatch(customer, /supplier|vendorId|internalNote|evidenceIds|candidateKey/);
});
