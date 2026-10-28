import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";

import { assertKnowledgePublisher, isAuthoritativeKnowledgeSource } from "../lib/ai/knowledge/publications";
import { extractKnowledgeSpans, splitKnowledgeText } from "../lib/ai/retrieval/ingestion";

test("company policy publication fails closed without a configured publisher role", () => {
  assert.throws(() => assertKnowledgePublisher({ id: "admin", role: "ADMIN", isActive: true }, undefined));
  assert.throws(() => assertKnowledgePublisher({ id: "account", role: "ACCOUNT", isActive: true }, "ADMIN"));
  assert.doesNotThrow(() => assertKnowledgePublisher({ id: "admin", role: "ADMIN", isActive: true }, "ADMIN"));
});

test("only confirmed records or explicitly published policy revisions enter retrieval", () => {
  assert.equal(isAuthoritativeKnowledgeSource({ originKind: "PROJECT_FILE", authorityStatus: "UPLOADED", projectId: "p", publicationStatus: null }), false);
  assert.equal(isAuthoritativeKnowledgeSource({ originKind: "COSTFLOW_IC", authorityStatus: "DRAFT", projectId: "p", publicationStatus: null }), false);
  assert.equal(isAuthoritativeKnowledgeSource({ originKind: "AI_OUTPUT", authorityStatus: "CONFIRMED", projectId: "p", publicationStatus: null }), false);
  assert.equal(isAuthoritativeKnowledgeSource({ originKind: "SOP", authorityStatus: "UPLOADED", projectId: null, publicationStatus: "DRAFT" }), false);
  assert.equal(isAuthoritativeKnowledgeSource({ originKind: "SOP", authorityStatus: "CONFIRMED", projectId: null, publicationStatus: "PUBLISHED" }), true);
  assert.equal(isAuthoritativeKnowledgeSource({ originKind: "VENDOR_INVOICE_FILE", authorityStatus: "CONFIRMED", projectId: "p", publicationStatus: null }), true);
});

test("bounded text chunks keep exact text offsets and stable content", () => {
  const chunks = splitKnowledgeText("First paragraph.\n\nSecond paragraph.", 240);
  assert.deepEqual(chunks.map(({ text }) => text), ["First paragraph.", "Second paragraph."]);
  assert.deepEqual(chunks.map(({ start, end }) => [start, end]), [[0, 16], [18, 35]]);
});

test("spreadsheet retrieval excludes cached formula values", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("IC");
  sheet.getCell("A1").value = "Authoritative source";
  sheet.getCell("B1").value = { formula: "1+998", result: 999 };
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const spans = await extractKnowledgeSpans(bytes,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.deepEqual(spans.map((span) => span.cellRange), ["A1"]);
  assert.equal(JSON.stringify(spans).includes("999"), false);
});
