import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { inventoryExcelWorkbook } from "../lib/ai/excel/workbookInventory";
import { buildMaskedStructurePayload } from "../lib/ai/excel/masking";
import { confidenceTier, proposeExcelMapping, type ReviewedExcelMapping } from "../lib/ai/excel/mapping";
import { previewReviewedExcelMapping } from "../lib/ai/excel/rebuildExcelIntakeInput";

async function workbookBytes(sheets = 1) {
  const workbook = new ExcelJS.Workbook();
  for (let index = 0; index < sheets; index++) {
    const sheet = workbook.addWorksheet(`Cost ${index + 1}`);
    sheet.addRow(["Name", "Quantity", "Price", "Note person@example.com 1234567890123456", "Nguyễn Văn Bí Mật"]);
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
  assert.equal(JSON.stringify(payload).includes("Nguyễn Văn Bí Mật"), false);
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
  assert.match(preview.mappingObservations!.join(" "), /HIDDEN_ROW/);
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

test("two separate quotation and IC sheets retain their own source coordinates", async () => {
  const inventory = await inventoryExcelWorkbook(await workbookBytes(2), upload);
  const both: ReviewedExcelMapping = { ...mapping, kind: "QUOTATION", additional: {
    sheet: "Cost 2", range: "A1:E3", headerRow: 1, kind: "IC", confidence: 0.82,
    columns: { name: 1, "buy.quantity": 2, "buy.unitPrice": 3 },
    rows: [{ row: 2, rowType: "ITEM", level: 1, parentRow: null }],
  }, confirmedCriticalCells: ["Cost 1!B2", "Cost 1!C2", "Cost 2!B2", "Cost 2!C2"] };
  const preview = previewReviewedExcelMapping(inventory, both);
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].coordinates.name.sheet, "Cost 1");
  assert.equal(preview.rows[1].coordinates.name.sheet, "Cost 2");
  assert.equal(preview.confidence, 0.82);
  assert.throws(() => previewReviewedExcelMapping(inventory, { ...both, additional: { ...both.additional!, kind: "QUOTATION" } }), /một bảng mỗi loại/);
});

test("model receives only minimized masked structure and cannot return values", async () => {
  const inventory = await inventoryExcelWorkbook(await workbookBytes(), upload);
  let outbound = "";
  const model = { extract: async (request: Parameters<import("../lib/ai/providers/types").GenerationModel["extract"]>[0]) => {
    outbound = JSON.stringify(request);
    return { providerRequestId: "mock-request", output: { task: "EXCEL_STRUCTURE" as const, warnings: [], candidates: [{
      key: "mapping", value: JSON.stringify({ ...mapping, sheet: "SHEET_1", reviewed: undefined, confirmedCriticalCells: undefined }),
      decimalValue: null, confidence: 0.92, sources: [request.authorizedSources[0].span], needsHumanReview: true,
    }] }, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
  } };
  const result = await proposeExcelMapping(inventory, model, new AbortController().signal);
  assert.equal(result.status, "PROPOSED");
  assert.equal(result.proposal?.sheet, "Cost 1");
  assert.equal(result.providerRequestId, "mock-request");
  assert.equal(outbound.includes("person@example.com"), false);
  assert.equal(outbound.includes("1234567890123456"), false);
  assert.equal(outbound.includes("Venue"), false);
  assert.equal(outbound.includes("Cost 1"), false);
  assert.equal(outbound.includes("Nguyễn Văn Bí Mật"), false);
  assert.equal(outbound.includes("B2*C2"), false);
  assert.ok(outbound.includes("<EMAIL_1>"));
  assert.ok(outbound.includes("SHEET_1"));
  const badModel = { extract: async (request: Parameters<import("../lib/ai/providers/types").GenerationModel["extract"]>[0]) => ({
    providerRequestId: "bad", output: { task: "EXCEL_STRUCTURE" as const, warnings: [], candidates: [{ key: "mapping",
      value: JSON.stringify({ ...mapping, sheet: "SHEET_1", value: "overwrite" }), decimalValue: null, confidence: 0.92,
      sources: [request.authorizedSources[0].span], needsHumanReview: true }] },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  }) };
  assert.equal((await proposeExcelMapping(inventory, badModel, new AbortController().signal)).status, "MANUAL_MAPPING");
});
