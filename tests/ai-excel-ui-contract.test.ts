import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createExcelPreviewState, reduceExcelPreviewState } from "../lib/costflow/excelPreviewState";

const source = (name: string) => readFile(path.join(process.cwd(), name), "utf8");

test("mapping state precedes the existing single preview and confirm authority", async () => {
  let state = createExcelPreviewState("workbook-A");
  state = reduceExcelPreviewState(state, { type: "REQUEST_STARTED", sourceRevision: 1 });
  state = reduceExcelPreviewState(state, { type: "MAPPING_READY", sourceRevision: 1 });
  assert.equal(state.pending, false);
  assert.equal(state.actionableSessionId, null);
  assert.equal(state.currentProjection, null);
  state = reduceExcelPreviewState(state, { type: "RESPONSE_SUCCEEDED", sourceRevision: 1, sessionId: "preview-1", projection: { rows: [] } });
  assert.equal(state.actionableSessionId, "preview-1");
  const stale = reduceExcelPreviewState(state, { type: "MAPPING_READY", sourceRevision: 0 });
  assert.equal(stale.actionableSessionId, "preview-1");
  const dialog = await source("components/ExcelIntakeDialog.tsx");
  assert.match(dialog, /MAPPING_READY[\s\S]*PREVIEW_OK/);
  assert.match(dialog, /requestId !== sequence\.current/);
  assert.equal((dialog.match(/confirmExcelIntakeAction\(/g) ?? []).length, 1);
  assert.match(dialog, /reviewedMapping/);
});

test("mapping review exposes confidence, source cells, critical confirmation and every exclusion", async () => {
  const review = await source("components/ai/AiExcelMappingReview.tsx");
  for (const label of ["AI nhận diện cấu trúc", "Thiết lập thủ công", "Bắt buộc xác nhận", "Lấy nguyên từ ô nguồn",
    "Dòng/cột chưa nhập", "Công thức", "Chọn sheet", "Vùng dữ liệu", "Hàng tiêu đề", "Dùng làm đề xuất"]) {
    assert.ok(review.includes(label), label);
  }
  assert.match(review, /sheet\.name}!\$\{row\.row}/);
  assert.match(review, /sourceId/);
  assert.match(review, /stage\.priorMappings/);
  assert.match(review, /confirmedCriticalCells/);
  assert.match(review, /onApply/);
  assert.doesNotMatch(review, /confirmExcelIntakeAction/);
  assert.doesNotMatch(review, /onKeyDown|preventDefault\(/);
  const css = await source("app/modules.css");
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.ai-excel-mapping-table tr/);
});

test("manual fallback keeps source state, and workbook scope remains opt in", async () => {
  const dialog = await source("components/ExcelIntakeDialog.tsx");
  const route = await source("app/api/projects/[id]/costflow/excel-intake/preview/route.ts");
  assert.match(dialog, /mappingStage: action\.key === "resumeSessionId" \? state\.mappingStage : null/);
  assert.match(dialog, /const visiblePreview = state\.mappingStage \? null : authority\.currentProjection/);
  assert.match(dialog, /loading=\{state\.pending\} disabled=\{!!state\.mappingStage\}/);
  assert.match(dialog, /onAnalyze=\{sourceId => void preview\(undefined, sourceId\)\}/);
  assert.match(dialog, /aiMappingIntent/);
  assert.match(route, /try \{ preview = await previewWorkbookIntake/);
  assert.match(route, /aiSourceId/);
  assert.match(route, /MANUAL_MAPPING/);
  assert.match(dialog, /Đã nhận diện bằng bộ đọc chuẩn — không gọi AI/);
  assert.match(dialog, /useEffect\(\(\) => \{ if \(!state\.open\) triggerRef\.current\?\.focus\(\)/);
});
