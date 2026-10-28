import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { inventoryExcelWorkbook } from "../lib/ai/excel/workbookInventory";
import { buildMaskedStructurePayload } from "../lib/ai/excel/masking";
import { confidenceTier, type ReviewedExcelMapping } from "../lib/ai/excel/mapping";
import { previewReviewedExcelMapping } from "../lib/ai/excel/rebuildExcelIntakeInput";

async function workbookBytes(sheets = 1) {
  const workbook = new ExcelJS.Workbook();
  for (let index = 0; index < sheets; index++) {
    const sheet = workbook.addWorksheet(`Cost ${index + 1}`);
    sheet.addRow(["Name", "Quantity", "Price", "Note"]);
    sheet.addRow(["Venue", 2, 1000, "contact person@example.com bank 1234567890123456"]);
    sheet.addRow(["Hidden", 3, 2000, "Excluded"]); sheet.getRow(3).hidden = true;
    sheet.getCell("E2").value = { formula: "B2*C2", result: 2000 };
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
const upload = { filename: "unknown.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
const mapping: ReviewedExcelMapping = { sheet: "Cost 1", range: "A1:E3", headerRow: 1, kind: "PAIRED", confidence: 0.92,
  columns: { name: 1, "sell.quantity": 2, "sell.unitPrice": 3 },
  rows: [{ row: 2, rowType: "ITEM", level: 1, parentRow: null }], reviewed: true,
  confirmedCriticalCells: ["Cost 1!B2", "Cost 1!C2"] };

test("unfamiliar workbook inventory is bounded and payload is masked", async () => {
  const inventory = await inventoryExcelWorkbook(await workbookBytes(), upload);
  const payload = buildMaskedStructurePayload(inventory);
  assert.equal(inventory.sheets.length, 1);
  assert.deepEqual(inventory.sheets[0].hiddenRows, [3]);
  assert.deepEqual(inventory.sheets[0].formulaCells, ["E2"]);
  assert.equal(JSON.stringify(payload).includes("person@example.com"), false);
  assert.equal(JSON.stringify(payload).includes("1234567890123456"), false);
  assert.equal(payload.tokenCounts.BANK_ACCOUNT, 1);
  assert.equal(payload.tokenCounts.EMAIL, 1);
  const threeSheets = await workbookBytes(3);
  await assert.rejects(() => inventoryExcelWorkbook(threeSheets, upload), /tối đa hai sheet/);
  await assert.rejects(() => inventoryExcelWorkbook(new Uint8Array([1, 2, 3]), upload), /ZIP/);
});

test("reviewed mapping rereads original cells and requires critical confirmation", async () => {
  const inventory = await inventoryExcelWorkbook(await workbookBytes(), upload);
  const preview = previewReviewedExcelMapping(inventory, mapping);
  assert.equal(preview.adapter, "AI_REVIEWED");
  assert.equal(preview.rows[0].name, "Venue");
  assert.equal(preview.rows[0].sell.quantity, "2");
  assert.equal(preview.rows[0].coordinates.sellQuantity.cell, "B2");
  assert.equal(preview.mappingProvenance?.fingerprint, inventory.fingerprint);
  assert.match(preview.mappingObservations!.join(" "), /Hidden rows/);
  assert.throws(() => previewReviewedExcelMapping(inventory, { ...mapping, confirmedCriticalCells: [] }), /xác nhận ô trọng yếu/);
  assert.throws(() => previewReviewedExcelMapping(inventory, { ...mapping, rows: [{ row: 3, rowType: "ITEM", level: 1, parentRow: null }] }), /mapping không hợp lệ/);
  assert.throws(() => previewReviewedExcelMapping(inventory, { ...mapping, columns: { ...mapping.columns, "sell.quantity": 5 } }), /công thức/);
});

test("confidence boundaries and proposal coordinates are strict", async () => {
  const inventory = await inventoryExcelWorkbook(await workbookBytes(), upload);
  assert.equal(confidenceTier(0.9), "PRESELECTED");
  assert.equal(confidenceTier(0.6), "CONFIRM");
  assert.equal(confidenceTier(0.59), "UNMAPPED");
  assert.throws(() => confidenceTier(1.01), /không hợp lệ/);
  assert.throws(() => previewReviewedExcelMapping(inventory, { ...mapping, range: "A1:F3" }), /vượt phạm vi/);
  assert.throws(() => previewReviewedExcelMapping(inventory, { ...mapping, confidence: 0.5 }), /nhập thủ công/);
});
