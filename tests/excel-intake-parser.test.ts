import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { previewPastedIntake, previewWorkbookIntake } from "../lib/costflow/excelIntakeParser";
import { preflightExcelWorkbook } from "../lib/costflow/excelIntakeSecurity";
import { createExcelIntakeTemplate } from "../lib/costflow/quotationExcel";

const canonicalUrl = "postgresql://postgres@127.0.0.1:55439/costflow_test";

test("paste and workbook adapters converge on the same v4 primitives and coordinates", async () => {
  const pasted = previewPastedIntake({
    text: "LEVEL\tROW_TYPE\tPARENT_ROW\tNAME\tDESCRIPTION\tSELL_UNIT\tSELL_QUANTITY\tSELL_DAYS\tSELL_UNIT_PRICE\tSELL_VAT\tSELL_BASIS\tSELL_NOTE\tBUY_UNIT\tBUY_QUANTITY\tBUY_DAYS\tBUY_UNIT_PRICE\tBUY_VAT\tBUY_BASIS\tSUPPLIER\tBUY_NOTE\n+1\tGROUP\t\tNhóm A\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\n+2\tITEM\t2\tHạng mục\tMô tả\tngày\t2\t1,5\t0\t8\tNET\tFOC\tngày\t2\t1\t1250,5\t10\tGROSS\tNCC\tNội bộ",
    sheet: "DAN_BANG",
  });
  assert.equal(pasted.rows[1].sell.days, "1.5");
  assert.equal(pasted.rows[1].coordinates.sellDays.cell, "H3");

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BAO_GIA_IC");
  sheet.addRows([
    ["EXCEL INTAKE v4 · BÁO GIÁ & IC"],
    ["LEVEL", "ROW_TYPE", "PARENT_ROW", "NAME", "DESCRIPTION", "SELL_UNIT", "SELL_QUANTITY", "SELL_DAYS", "SELL_UNIT_PRICE", "SELL_VAT", "SELL_BASIS", "SELL_NOTE", "BUY_UNIT", "BUY_QUANTITY", "BUY_DAYS", "BUY_UNIT_PRICE", "BUY_VAT", "BUY_BASIS", "SUPPLIER", "BUY_NOTE"],
    [1, "GROUP", "", "Nhóm A"],
    [2, "ITEM", 3, "Hạng mục", "Mô tả", "ngày", 2, 1.5, 0, 8, "NET", "FOC", "ngày", 2, 1, 1250.5, 10, "GROSS", "NCC", "Nội bộ"],
  ]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await previewWorkbookIntake(bytes, { sheet: "BAO_GIA_IC", range: "A2:T4" });
  assert.equal(parsed.rows[1].sell.days, pasted.rows[1].sell.days);
  assert.equal(parsed.rows[1].buy.unitPrice, pasted.rows[1].buy.unitPrice);
  assert.equal(parsed.source.sheet, "BAO_GIA_IC");
});

test("standard v4 workbook accepts preview formulas without executing them", async () => {
  const bytes = Buffer.from(await createExcelIntakeTemplate({ projectName: "Sự kiện thử nghiệm" }));
  const parsed = await previewWorkbookIntake(bytes);

  assert.equal(parsed.adapter, "STANDARD_V4");
  assert.equal(parsed.rows.length, 4, "blank template rows with preview formulas are not imported");
  assert.equal(parsed.rows[1].name, "Điều phối");
  assert.equal(parsed.rows[1].sell.quantity, "2");
  assert.equal(parsed.rows[1].sell.days, "1.5");
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.observations.length, 18);
  assert.ok(parsed.warnings.every(warning => warning.code === "FORMULA_IGNORED" && !warning.blocking));
});

test("standard v4 workbook infers familiar hierarchy and ignores default-only rows", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await createExcelIntakeTemplate());
  const sheet = workbook.getWorksheet("BAO_GIA_IC")!;
  sheet.getCell("C11").value = "Chi tiết Booth";
  sheet.getCell("I11").value = "NET";
  sheet.getCell("J11").value = 8;
  sheet.getCell("O11").value = "người";
  sheet.getCell("S11").value = "NET";
  sheet.getCell("T11").value = 8;
  sheet.getCell("I12").value = "NET";
  sheet.getCell("J12").value = 8;
  sheet.getCell("O12").value = "người";
  sheet.getCell("S12").value = "NET";
  sheet.getCell("T12").value = 8;

  const parsed = await previewWorkbookIntake(Buffer.from(await workbook.xlsx.writeBuffer()));

  assert.equal(parsed.rows.length, 5, "a row with only spreadsheet defaults is not an intake row");
  assert.equal(parsed.rows[4].level, 3);
  assert.equal(parsed.rows[4].parentCandidateKey, parsed.rows[3].candidateKey);
  assert.equal(parsed.errors.length, 0);
});

test("preflight rejects active content, formulas, traversal and resource-limit violations", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("xl/workbook.xml", "<workbook/>");
  zip.file("../evil.xml", "bad");
  const traversalBytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
  await assert.rejects(() => preflightExcelWorkbook(traversalBytes), /đường dẫn|ZIP/i);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BAO_GIA_IC");
  sheet.getCell("A1").value = { formula: "1+1", result: 2 };
  const formulaBytes = Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(() => previewWorkbookIntake(formulaBytes, { sheet: "BAO_GIA_IC", range: "A1:A1" }), /công thức/i);
});

test("integration URL probe accepts only the exact canonical URL", () => {
  const runner = "scripts/test-costflow.mjs";
  const pass = spawnSync(process.execPath, [runner, "--integration", "--check-integration-database-url"], {
    env: { ...process.env, COSTFLOW_TEST_DATABASE_URL: canonicalUrl }, encoding: "utf8",
  });
  assert.equal(pass.status, 0, pass.stderr);
  for (const url of [
    "postgresql://postgres@127.0.0.1:55439/taskflow",
    "postgresql://postgres@127.0.0.1:55440/costflow_test",
    "postgresql://other@127.0.0.1:55439/costflow_test",
    "postgresql://postgres:secret@127.0.0.1:55439/costflow_test",
    `${canonicalUrl}?schema=public`, `${canonicalUrl}#fragment`,
    "postgresql://postgres@localhost:55439/costflow_test",
  ]) {
    const result = spawnSync(process.execPath, [runner, "--integration", "--check-integration-database-url"], {
      env: { ...process.env, COSTFLOW_TEST_DATABASE_URL: url }, encoding: "utf8",
    });
    assert.notEqual(result.status, 0, `accepted ${url}`);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /tests\/.*\.test|DATABASE_URL=/);
  }
});
