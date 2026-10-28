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
    const source = await client.projectFile.create({ data: { projectId: project.id, name: "unknown.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: bytes.length, data: bytes } });
    const previousAi = Object.fromEntries(["AI_ENABLED", "AI_PROVIDER", "OPENAI_API_KEY", "AI_GENERATION_MODEL", "AI_EMBEDDING_MODEL", "AI_TIMEOUT_MS", "AI_MAX_OUTPUT_TOKENS", "AI_MAX_CONCURRENCY"].map(key => [key, process.env[key]]));
    Object.assign(process.env, { AI_ENABLED: "true", AI_PROVIDER: "openai", OPENAI_API_KEY: "offline-test-only",
      AI_GENERATION_MODEL: "gpt-6-luna", AI_EMBEDDING_MODEL: "text-embedding-3-small", AI_TIMEOUT_MS: "10000", AI_MAX_OUTPUT_TOKENS: "100", AI_MAX_CONCURRENCY: "1" });
    let mappingRunId = "";
    try {
      const { createAiRun } = await import("../lib/ai/runs/aiRunService");
      const { executeExcelMappingRun } = await import("../lib/ai/excel/mappingRun");
      const run = await createAiRun(actor.id, project.id, { intent: "ANALYZE", task: "EXCEL_STRUCTURE", sourceIds: [`PROJECT_FILE:${source.id}`] });
      mappingRunId = run.id;
      let calls = 0;
      const model = { extract: async (request: Parameters<import("../lib/ai/providers/types").GenerationModel["extract"]>[0]) => {
        calls++;
        return { providerRequestId: "excel-mock", output: { task: "EXCEL_STRUCTURE" as const, warnings: [], candidates: [{
          key: "mapping", value: JSON.stringify({ sheet: "SHEET_1", range: "A1:C2", headerRow: 1, kind: "QUOTATION",
            columns: { name: 1, "sell.quantity": 2, "sell.unitPrice": 3 }, rows: [{ row: 2, rowType: "ITEM", level: 1, parentRow: null }], confidence: 0.95 }),
          decimalValue: null, confidence: 0.95, sources: [request.authorizedSources[0].span], needsHumanReview: true }] },
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
      } };
      await assert.rejects(() => executeExcelMappingRun(actor.id, project.id, run.id, Buffer.from("different"), inventory, model), /not found/i);
      const suggested = await executeExcelMappingRun(actor.id, project.id, run.id, bytes, inventory, model);
      assert.equal(suggested.status, "PROPOSED");
      assert.equal(calls, 1);
      assert.equal((await executeExcelMappingRun(actor.id, project.id, run.id, bytes, inventory, model)).reused, true);
      assert.equal(calls, 1);
      assert.equal(await client.aiCandidateField.count({ where: { runId: run.id } }), 1);
      assert.equal((await client.aiRun.findUniqueOrThrow({ where: { id: run.id } })).providerRequestId, "excel-mock");
    } finally {
      for (const [key, value] of Object.entries(previousAi)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
    preview.mappingProvenance!.runId = mappingRunId;
    const session = await createNewDraftExcelIntakePreview({ id: actor.id, role: "ACCOUNT" }, { projectId: project.id, preview,
      sourceKind: "XLSX", sourceRevision: 1, sourceFilename: "unknown.xlsx", sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceBytes: bytes });
    assert.equal(await client.costFlowWorkspace.count({ where: { projectId: project.id } }), 0);
    assert.equal(await client.excelIntakeOperationReceipt.count({ where: { projectId: project.id } }), 0);
    const result = await confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, { projectId: project.id, previewSessionId: session.previewSessionId,
      expectedVersion: 0, idempotencyKey: `excel-${suffix}`, corrections: {}, decimalResolutions: {} });
    assert.equal(result.idempotent, false);
    assert.equal(await client.aiMappingAdapter.count({ where: { projectId: project.id } }), 1);
    const { listPriorExcelMappings } = await import("../lib/ai/excel/mappingRun");
    const prior = await listPriorExcelMappings(actor.id, project.id, inventory);
    assert.equal(prior.length, 1);
    assert.equal(prior[0].requiresReview, true);
    assert.equal(prior[0].label, "Đã từng dùng mapping này");
    const receipt = await client.excelIntakeOperationReceipt.findFirstOrThrow({ where: { projectId: project.id } });
    assert.match(JSON.stringify(receipt.result), /mappingProvenance/);
    assert.match(JSON.stringify(receipt.result), new RegExp(inventory.fingerprint));
    const repeated = await confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, { projectId: project.id, previewSessionId: session.previewSessionId,
      expectedVersion: 0, idempotencyKey: `excel-${suffix}`, corrections: {}, decimalResolutions: {} });
    assert.equal(repeated.idempotent, true);
    Object.assign(process.env, { AI_ENABLED: "true", AI_PROVIDER: "openai", OPENAI_API_KEY: "offline-test-only",
      AI_GENERATION_MODEL: "gpt-6-luna", AI_EMBEDDING_MODEL: "text-embedding-3-small", AI_TIMEOUT_MS: "10000", AI_MAX_OUTPUT_TOKENS: "100", AI_MAX_CONCURRENCY: "1" });
    try {
      const { createAiRun } = await import("../lib/ai/runs/aiRunService");
      const { recordPriorExcelMappingRun } = await import("../lib/ai/excel/mappingRun");
      const reusedRun = await createAiRun(actor.id, project.id, { intent: "ANALYZE", task: "EXCEL_STRUCTURE",
        sourceIds: [`PROJECT_FILE:${source.id}`] }, { forceNew: true });
      assert.notEqual(reusedRun.id, mappingRunId);
      const reviewedMapping = { sheet: "Cost", range: "A1:C2", headerRow: 1, kind: "QUOTATION" as const, confidence: 0.95,
        columns: { name: 1, "sell.quantity": 2, "sell.unitPrice": 3 }, rows: [{ row: 2, rowType: "ITEM" as const, level: 1 as const, parentRow: null }],
        reviewed: true as const, confirmedCriticalCells: ["Cost!B2", "Cost!C2"], adapterId: prior[0].id };
      const newRunId = await recordPriorExcelMappingRun(actor.id, project.id, reusedRun.id, bytes, inventory, reviewedMapping);
      const secondPreview = previewReviewedExcelMapping(inventory, { ...reviewedMapping, runId: newRunId });
      const secondSession = await createNewDraftExcelIntakePreview({ id: actor.id, role: "ACCOUNT" }, { projectId: project.id, preview: secondPreview,
        sourceKind: "XLSX", sourceRevision: 2, sourceFilename: "unknown.xlsx", sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceBytes: bytes });
      await confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, { projectId: project.id, previewSessionId: secondSession.previewSessionId,
        expectedVersion: 1, idempotencyKey: `excel-reuse-${suffix}`, corrections: {}, decimalResolutions: {} });
      const adapters = await client.aiMappingAdapter.findMany({ where: { projectId: project.id } });
      assert.equal(adapters.length, 2);
      assert.ok(adapters.some(item => item.confirmedRunId === newRunId));
    } finally {
      for (const [key, value] of Object.entries(previousAi)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
});
