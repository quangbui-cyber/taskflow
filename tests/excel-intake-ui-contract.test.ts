import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createExcelPreviewState, reduceExcelPreviewState } from "../lib/costflow/excelPreviewState";

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
