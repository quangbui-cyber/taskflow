import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssistantResponse } from "../lib/ai/qa/answerView";

const source = { spanId: "span-1", sourceRevisionId: "rev-1", originKind: "SOP",
  originId: "sop-1", originVersion: "v1", filename: "policy.txt", historical: false,
  pageNumber: 1, sheetName: null, cellRange: null, xmlPath: null, textStart: 0, textEnd: 20 };

test("successful answer cannot render without a matching adjacent source", () => {
  const base = { status: "OK", claims: [{ text: "Approved amount", citationSpanIds: ["span-1"] }],
    sources: [source], conflicts: [], missingEvidence: null, confirmingRole: null };
  assert.deepEqual(normalizeAssistantResponse(base), base);
  assert.equal(normalizeAssistantResponse({ ...base, claims: [{ ...base.claims[0], citationSpanIds: [] }] }), null);
  assert.equal(normalizeAssistantResponse({ ...base, sources: [] }), null);
  assert.equal(normalizeAssistantResponse({ ...base, claims: [{ text: "Uncited", citationSpanIds: ["unknown"] }] }), null);
  const conflict = normalizeAssistantResponse({ ...base, status: "CONFLICT" });
  assert.deepEqual(conflict?.claims, []);
});
