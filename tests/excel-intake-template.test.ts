import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createExcelIntakeTemplate, createExcelRoundTripWorkbook } from "../lib/costflow/quotationExcel";
import { createRoundTripProjection } from "../lib/costflow/excelRoundTrip";
import { blankPairedRow } from "../lib/costflow/pairedDraft";
import type { PairedDraft } from "../lib/costflow/types";

test("v4 workbook reopens with paired layout, three levels and preview-only formulas", async () => {
  const bytes = await createExcelIntakeTemplate({ projectName: "Project mẫu", customer: "Khách hàng mẫu", generatedAt: "2026-10-10T00:00:00.000Z" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map(sheet => [sheet.name, sheet.state]), [
    ["BAO_GIA_IC", "visible"], ["_IMPORT", "veryHidden"], ["_META", "veryHidden"],
  ]);
  const sheet = workbook.getWorksheet("BAO_GIA_IC")!;
  assert.equal(sheet.getCell("B1").value, "EXCEL INTAKE v4 · BÁO GIÁ & IC");
  assert.deepEqual(["E6", "F6", "G6", "H6", "I6", "J6", "K6", "L6", "M6", "N6"].map(ref => sheet.getCell(ref).value), ["ĐVT", "SỐ LƯỢNG", "SỐ NGÀY", "ĐƠN GIÁ", "CƠ SỞ", "VAT %", "NET", "VAT", "GROSS", "GHI CHÚ KHÁCH"]);
  assert.deepEqual(["O6", "P6", "Q6", "R6", "S6", "T6", "U6", "V6", "W6", "X6", "Y6"].map(ref => sheet.getCell(ref).value), ["ĐVT MUA", "SL MUA", "SỐ NGÀY MUA", "GIÁ VỐN", "CƠ SỞ MUA", "VAT MUA %", "NET IC", "VAT IC", "GROSS IC", "NHÀ CUNG CẤP", "GHI CHÚ NỘI BỘ"]);
  const sellFill = sheet.getCell("E6").fill;
  const buyFill = sheet.getCell("O6").fill;
  assert.equal(sellFill.type, "pattern");
  assert.equal(buyFill.type, "pattern");
  if (sellFill.type === "pattern") assert.equal(sellFill.fgColor?.argb, "FFC6E0B4");
  if (buyFill.type === "pattern") assert.equal(buyFill.fgColor?.argb, "FFFFD966");
  assert.deepEqual([7, 8, 9].map(row => sheet.getCell(`A${row}`).value), [1, 2, 3]);
  assert.equal(sheet.getCell("H10").value, 0);
  assert.match(String(sheet.getCell("N10").value), /FOC/);
  assert.deepEqual(sheet.getCell("G8").dataValidation.formulae, [0]);
  assert.deepEqual(sheet.getCell("I8").dataValidation.formulae, ['"NET,GROSS"']);
  assert.equal((sheet.getCell("K8").value as ExcelJS.CellFormulaValue).formula, 'IF(OR(F8="",G8="",H8="",I8="",J8=""),"",IF(I8="NET",F8*G8*H8,F8*G8*H8/(1+J8/100)))');
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.views[0].ySplit, 6);
  assert.equal(sheet.pageSetup.orientation, "landscape");
  assert.equal(workbook.getWorksheet("_META")!.getCell("B1").value, 4);
  assert.match(String(workbook.getWorksheet("_META")!.getCell("B4").value), /preview.*server|server.*preview/i);
  const text = Buffer.from(bytes).toString("utf8");
  for (const sentinel of ["EVIDENCE_PRIVATE", "PASSWORD_PRIVATE", "SECRET_PRIVATE", "VENDOR_SOURCE_SHEET"]) assert.ok(!text.includes(sentinel));
});

test("template route and visible action retain Project-scoped authorization and private headers", async () => {
  const route = await readFile(path.join(process.cwd(), "app/api/projects/[id]/costflow/excel-intake/template/route.ts"), "utf8");
  assert.match(route, /getCurrentUser/);
  assert.match(route, /status:\s*401/);
  assert.match(route, /role\s*===\s*"ADMIN"/);
  assert.match(route, /role\s*===\s*"ACCOUNT"/);
  assert.match(route, /projectId_userId|members:\s*\{\s*some/);
  assert.match(route, /status:\s*404/);
  assert.match(route, /private, no-store/);
  assert.match(route, /nosniff/);
  assert.match(route, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  const panel = await readFile(path.join(process.cwd(), "components/QuotationPanel.tsx"), "utf8");
  assert.match(panel, /canCreate[\s\S]*excel-intake\/template/);
  assert.match(panel, /Tải mẫu Excel v4/);
});

test("derived v4 artifact reopens without formula errors, active content or external relationships", async () => {
  const artifactDirectory = path.join(process.cwd(), ".codex-tmp");
  const artifactPath = path.join(artifactDirectory, "excel-intake-v4-derived-test.xlsx");
  await mkdir(artifactDirectory, { recursive: true });
  const bytes = await createExcelIntakeTemplate({ generatedAt: "2026-10-10T00:00:00.000Z" });
  await writeFile(artifactPath, Buffer.from(bytes));
  assert.ok((await stat(artifactPath)).size > 0);
  const saved = await readFile(artifactPath);
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer);
  const formulas: string[] = [];
  reopened.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
    if (cell.type !== ExcelJS.ValueType.Formula) return;
    const value = cell.value as ExcelJS.CellFormulaValue;
    formulas.push(value.formula);
    assert.doesNotMatch(value.formula, /\[[^\]]+\]|https?:|file:/i);
    if (typeof value.result === "string") assert.doesNotMatch(value.result, /^#(?:REF|VALUE|DIV\/0|NAME|N\/A|NUM|NULL)!?$/i);
  })));
  assert.ok(formulas.length >= 24, "expected preview formula coverage for the example rows");
  const zip = await JSZip.loadAsync(saved);
  const entryNames = Object.keys(zip.files);
  assert.ok(!entryNames.some(name => /vbaProject\.bin|externalLinks|connections\.xml|embeddings\//i.test(name)));
  const xmlText = (await Promise.all(entryNames.filter(name => name.endsWith(".xml") || name.endsWith(".rels")).map(name => zip.file(name)!.async("string")))).join("\n");
  for (const privateToken of ["EVIDENCE_PRIVATE", "PASSWORD_PRIVATE", "SECRET_PRIVATE", "APPROVAL_PRIVATE", "CASH_PRIVATE"]) assert.ok(!xmlText.includes(privateToken));
});

test("hybrid workbook keeps visible numerics and hidden exact canonical text for all eight primitives", async () => {
  const draft: PairedDraft = {
    linePricingSchemaVersion: 2, id: "draft-exact", version: 1, createdBy: "actor-1", workspaceMode: "paired",
    title: "Exact", clientId: "", customer: "", notes: "", globalEvidenceIds: [], rows: [],
  };
  const row = blankPairedRow("row-exact", null, "ITEM");
  row.name = "Exact";
  row.sell = { ...row.sell, quantity: "9007199254740993", days: "0.333333333333333333333333", unitPrice: "0", vatPercent: "0" };
  row.buy = { ...row.buy, quantity: "1.2345", days: "2.5", unitPrice: "9999999999999999.99", vatPercent: "100" };
  draft.rows = [row];
  const bytes = await createExcelRoundTripWorkbook(createRoundTripProjection("project-exact", draft));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const visible = workbook.getWorksheet("BAO_GIA_IC")!;
  const canonical = workbook.getWorksheet("_IMPORT")!;
  for (const address of ["F7", "G7", "H7", "J7", "P7", "Q7", "R7", "T7"]) {
    assert.equal(typeof visible.getCell(address).value, "number", `${address} must remain a familiar Excel number`);
  }
  assert.deepEqual(canonical.getRow(2).values?.slice(7, 15), [
    "9007199254740993", "0.333333333333333333333333", "0", "0",
    "1.2345", "2.5", "9999999999999999.99", "100",
  ]);
  for (let column = 7; column <= 14; column++) assert.equal(canonical.getRow(2).getCell(column).numFmt, "@");
  assert.match((visible.getCell("K7").value as ExcelJS.CellFormulaValue).formula, /F7\*G7\*H7/);
});
