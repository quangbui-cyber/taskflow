import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("Excel intake dialog exposes both sources, exact issue focus and Foundation primitives", async () => {
  const source = await readFile(path.join(process.cwd(), "components/ExcelIntakeDialog.tsx"), "utf8");
  for (const label of ["Dán bảng", "Tải XLSX", "Sheet", "Vùng dữ liệu", "Lỗi cần sửa", "Cảnh báo", "Sheet · dòng · ô", "Tạo nháp mới"]) assert.ok(source.includes(label), label);
  for (const primitive of ["Dialog", "Field", "Alert", "Table", "Button"]) assert.match(source, new RegExp(`\\b${primitive}\\b`));
  assert.match(source, /excel-intake-row-/);
  assert.match(source, /aria-live/);
  assert.match(source, /disabled=[\s\S]*blocking|blocking[\s\S]*disabled/);
});

test("reducer preserves raw cells and corrections across stale or failed responses", async () => {
  const source = await readFile(path.join(process.cwd(), "components/ExcelIntakeDialog.tsx"), "utf8");
  assert.match(source, /action\.requestId\s*!==\s*state\.requestId[\s\S]*return state/);
  assert.match(source, /REQUEST_FAILED[\s\S]*\.\.\.state[\s\S]*error:/);
  assert.match(source, /corrections:\s*\{\s*\.\.\.state\.corrections/);
  assert.match(source, /Dữ liệu và các ô đã sửa vẫn được giữ/);
});

test("quotation panel opens the creator-only intake dialog and customer view remains private", async () => {
  const panel = await readFile(path.join(process.cwd(), "components/QuotationPanel.tsx"), "utf8");
  assert.match(panel, /canCreate[\s\S]*ExcelIntakeDialog/);
  const customer = await readFile(path.join(process.cwd(), "components/CustomerQuotationView.tsx"), "utf8");
  assert.doesNotMatch(customer, /supplier|vendorId|internalNote|evidenceIds|candidateKey/);
});
