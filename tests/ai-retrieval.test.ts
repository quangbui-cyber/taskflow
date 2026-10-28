import assert from "node:assert/strict";
import test from "node:test";

import { assertKnowledgePublisher, isAuthoritativeKnowledgeSource } from "../lib/ai/knowledge/publications";
import { splitKnowledgeText } from "../lib/ai/retrieval/ingestion";

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
