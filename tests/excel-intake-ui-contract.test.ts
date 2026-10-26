import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createExcelPreviewState, reduceExcelPreviewState } from "../lib/costflow/excelPreviewState";
import { excelIntakeDiagnosticTargetId, normalizeExcelIntake, type ExcelIntakePrimitiveCell, type ExcelIntakeRowInput } from "../lib/costflow/excelIntake";

test("shared preview state stages source changes and isolates every revision", () => {
  const projectionA = { rows: [{ candidateKey: "A" }] };
  let state = createExcelPreviewState("paste-A");
  state = reduceExcelPreviewState(state, { type: "RESPONSE_SUCCEEDED", sourceRevision: 1, sessionId: "session-A", projection: projectionA });
  state = reduceExcelPreviewState(state, { type: "SET_CORRECTION", key: "A.sell.unitPrice", value: "100" });
  state = reduceExcelPreviewState(state, { type: "SOURCE_CHANGE_INTENT", source: "paste-B" });
  assert.equal(state.actionableSessionId, null);
  assert.equal(state.currentProjection, null);
  assert.deepEqual(state.staleProjection, projectionA);
  assert.equal(state.pendingSourceChange?.requiresDiscardWarning, true);

  state = reduceExcelPreviewState(state, { type: "STAY_CONFIRMED", serverState: "ACTIONABLE" });
  assert.equal(state.selectedSource, "paste-A");
  assert.equal(state.actionableSessionId, "session-A");
  assert.equal(state.corrections["A.sell.unitPrice"], "100");

  state = reduceExcelPreviewState(state, { type: "SOURCE_CHANGE_INTENT", source: "paste-B" });
  state = reduceExcelPreviewState(state, { type: "SOURCE_CANCELLED" });
  assert.equal(state.selectedSource, "paste-B");
  assert.equal(state.sourceRevision, 2);
  assert.deepEqual(state.corrections, {});
  state = reduceExcelPreviewState(state, { type: "REQUEST_STARTED", sourceRevision: 2 });
  const afterLateA = reduceExcelPreviewState(state, { type: "RESPONSE_SUCCEEDED", sourceRevision: 1, sessionId: "late-A", projection: projectionA });
  assert.equal(afterLateA.actionableSessionId, null);
  assert.equal(afterLateA.notice, "Đã bỏ kết quả của nguồn cũ");
  const projectionB = { rows: [{ candidateKey: "B" }] };
  state = reduceExcelPreviewState(afterLateA, { type: "RESPONSE_SUCCEEDED", sourceRevision: 2, sessionId: "session-B", projection: projectionB });
  assert.equal(state.actionableSessionId, "session-B");
  assert.deepEqual(state.currentProjection, projectionB);
  state = reduceExcelPreviewState(state, { type: "SERVER_STATUS", serverState: "NON_ACTIONABLE_SUPERSEDED" });
  assert.equal(state.actionableSessionId, null);
  assert.deepEqual(state.staleProjection, projectionB);
});

test("Excel intake dialog exposes both sources, exact issue focus and Foundation primitives", async () => {
  const source = await readFile(path.join(process.cwd(), "components/ExcelIntakeDialog.tsx"), "utf8");
  for (const label of ["Dán bảng", "Tải XLSX", "Sheet", "Vùng dữ liệu", "Lỗi cần sửa", "Cảnh báo", "Sheet · dòng · ô", "Tạo nháp mới"]) assert.ok(source.includes(label), label);
  for (const primitive of ["Dialog", "Field", "Alert", "Table", "Button"]) assert.match(source, new RegExp(`\\b${primitive}\\b`));
  assert.match(source, /excel-intake-row-/);
  assert.match(source, /aria-live/);
  assert.match(source, /disabled=[\s\S]*blocking|blocking[\s\S]*disabled/);
});

test("duplicate fields and decimal conflicts target their exact owning controls", () => {
  const source = (candidateKey: string, row: number, cell: string) => ({ sheet: "BAO_GIA_IC", row, column: 9, cell });
  const first = { code: "INVALID_NUMBER" as const, message: "Sai", candidateKey: "candidate-1", side: "sell" as const, field: "sell.unitPrice", source: source("candidate-1", 3, "I3"), blocking: true as const };
  const second = { ...first, candidateKey: "candidate-2", source: source("candidate-2", 4, "I4") };
  assert.equal(excelIntakeDiagnosticTargetId(first), "excel-intake-row-candidate-1-sell-unitPrice");
  assert.equal(excelIntakeDiagnosticTargetId(second), "excel-intake-row-candidate-2-sell-unitPrice");
  assert.notEqual(excelIntakeDiagnosticTargetId(first), excelIntakeDiagnosticTargetId(second));

  const mismatch = { conflictId: "candidate-2:sell.unitPrice:I4", candidateKey: "candidate-2", side: "sell" as const, field: "sell.unitPrice" as const, visible: "1.234", canonical: "1234", source: source("candidate-2", 4, "I4"), canonicalSource: { sheet: "_IMPORT", row: 3, column: 9, cell: "I3" }, reason: "VISIBLE_CANONICAL_MISMATCH" as const };
  const ambiguous = { ...mismatch, conflictId: "candidate-2:sell.unitPrice:I5", source: source("candidate-2", 5, "I5"), reason: "AMBIGUOUS_DECIMAL" as const };
  assert.equal(excelIntakeDiagnosticTargetId(mismatch), "excel-intake-conflict-candidate-2-sell-unitPrice-candidate-2-sell-unitPrice-I4");
  assert.equal(excelIntakeDiagnosticTargetId(ambiguous), "excel-intake-conflict-candidate-2-sell-unitPrice-candidate-2-sell-unitPrice-I5");
});

test("normalization stamps every error and warning with row, field and source identity", () => {
  const cell = (value: unknown, row: number, column: number): ExcelIntakePrimitiveCell => ({ value, source: { sheet: "BAO_GIA_IC", row, column, cell: `${String.fromCharCode(64 + column)}${row}` } });
  const side = (row: number) => ({ unit: cell("cái", row, 6), quantity: cell("bad", row, 7), days: cell("1", row, 8), unitPrice: cell("0", row, 9), vatPercent: cell("8", row, 10), basis: cell("NET", row, 11), note: cell("", row, 12) });
  const rows: ExcelIntakeRowInput[] = [3, 4].map(row => ({ level: cell(2, row, 1), rowType: cell("ITEM", row, 2), parentRow: cell("", row, 3), name: cell(`Dòng ${row}`, row, 4), description: cell("", row, 5), sell: side(row), buy: { ...side(row), supplier: cell("NCC", row, 19) }, previewNet: { ...cell(0, row, 21), observation: { formula: "G*I", cachedValue: 0 } } }));
  const normalized = normalizeExcelIntake({ schemaVersion: 4, source: { kind: "XLSX", sheet: "BAO_GIA_IC", range: "A2:U4" }, metadata: { projectName: "", customer: "", preparedAt: "", location: "" }, rows });
  assert.ok(normalized.errors.length > 2);
  assert.ok(normalized.warnings.length === 2);
  for (const issue of [...normalized.errors, ...normalized.warnings]) {
    assert.ok(issue.candidateKey);
    assert.ok(issue.field);
    assert.ok(issue.source.cell);
  }
  const duplicate = normalized.errors.filter(issue => issue.field === "sell.quantity");
  assert.deepEqual(duplicate.map(issue => issue.candidateKey), ["candidate-1", "candidate-2"]);
});

test("reducer preserves raw cells and corrections across stale or failed responses", async () => {
  const source = await readFile(path.join(process.cwd(), "lib/costflow/excelPreviewState.ts"), "utf8");
  assert.match(source, /sourceRevision[\s\S]*Đã bỏ kết quả của nguồn cũ/);
  assert.match(source, /REQUEST_FAILED|RESPONSE_FAILED/);
  assert.match(source, /corrections:\s*\{\s*\.\.\.state\.corrections/);
  assert.match(source, /Dữ liệu và các ô đã sửa vẫn được giữ/);
});

test("intake dialog cancels exact authority before installing source and offers Stay", async () => {
  const source = await readFile(path.join(process.cwd(), "components/ExcelIntakeDialog.tsx"), "utf8");
  const reducer = await readFile(path.join(process.cwd(), "lib/costflow/excelPreviewState.ts"), "utf8");
  assert.match(source, /reduceExcelPreviewState/);
  assert.match(source, /method:\s*"DELETE"/);
  assert.match(source, /Tiếp tục và bỏ lựa chọn/);
  assert.match(source, /Ở lại/);
  assert.match(source, /Không còn áp dụng/);
  assert.match(`${source}\n${reducer}`, /Đã bỏ kết quả của nguồn cũ/);
});

test("quotation panel opens the creator-only intake dialog and customer view remains private", async () => {
  const panel = await readFile(path.join(process.cwd(), "components/QuotationPanel.tsx"), "utf8");
  assert.match(panel, /canCreate[\s\S]*ExcelIntakeDialog/);
  const customer = await readFile(path.join(process.cwd(), "components/CustomerQuotationView.tsx"), "utf8");
  assert.doesNotMatch(customer, /supplier|vendorId|internalNote|evidenceIds|candidateKey/);
});
