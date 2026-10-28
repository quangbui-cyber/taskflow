import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { withPhase15TestSchema } from "./phase15/fixture";
import { inventoryExcelWorkbook } from "../lib/ai/excel/workbookInventory";
import { previewReviewedExcelMapping } from "../lib/ai/excel/rebuildExcelIntakeInput";

test("reviewed mapping enters existing preview and confirm authority", { skip: !process.env.COSTFLOW_TEST_DATABASE_URL }, async () => {
  await withPhase15TestSchema("push", async ({ client, databaseUrl }) => {
    process.env.DATABASE_URL = databaseUrl;
    const { createNewDraftExcelIntakePreview, confirmExcelIntake } = await import("../lib/costflow/excelIntakeService");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Cost");
    sheet.addRow(["Name", "Quantity", "Price"]);
    sheet.addRow(["Venue", 2, 1000]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const inventory = await inventoryExcelWorkbook(bytes, { filename: "unknown.xlsx" });
    const preview = previewReviewedExcelMapping(inventory, { sheet: "Cost", range: "A1:C2", headerRow: 1, kind: "QUOTATION", confidence: 0.95,
      columns: { name: 1, "sell.quantity": 2, "sell.unitPrice": 3 },
      rows: [{ row: 2, rowType: "ITEM", level: 1, parentRow: null }], reviewed: true,
      confirmedCriticalCells: ["Cost!B2", "Cost!C2"] });
    assert.equal(preview.errors.length, 0);
    const suffix = randomUUID();
    const actor = await client.user.create({ data: { name: "Excel mapper", email: `excel-${suffix}@example.test`, passwordHash: "unused", role: "ACCOUNT", isActive: true } });
    const project = await client.project.create({ data: { name: `Excel ${suffix}`, ownerId: actor.id, revenue: 0, members: { create: { userId: actor.id } } } });
    const session = await createNewDraftExcelIntakePreview({ id: actor.id, role: "ACCOUNT" }, { projectId: project.id, preview,
      sourceKind: "XLSX", sourceRevision: 1, sourceFilename: "unknown.xlsx", sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceBytes: bytes });
    assert.equal(await client.costFlowWorkspace.count({ where: { projectId: project.id } }), 0);
    assert.equal(await client.excelIntakeOperationReceipt.count({ where: { projectId: project.id } }), 0);
    const result = await confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, { projectId: project.id, previewSessionId: session.previewSessionId,
      expectedVersion: 0, idempotencyKey: `excel-${suffix}`, corrections: {}, decimalResolutions: {} });
    assert.equal(result.idempotent, false);
    const receipt = await client.excelIntakeOperationReceipt.findFirstOrThrow({ where: { projectId: project.id } });
    assert.match(JSON.stringify(receipt.result), /mappingProvenance/);
    assert.match(JSON.stringify(receipt.result), new RegExp(inventory.fingerprint));
    const repeated = await confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, { projectId: project.id, previewSessionId: session.previewSessionId,
      expectedVersion: 0, idempotencyKey: `excel-${suffix}`, corrections: {}, decimalResolutions: {} });
    assert.equal(repeated.idempotent, true);
  });
});
