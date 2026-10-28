import assert from "node:assert/strict";
import test from "node:test";

import { buildDeterministicCandidates } from "../lib/ai/extraction/documentExtraction";
import { validateAiFieldReview } from "../lib/ai/review/reviewService";

test("PO fields come from exact parser spans without invoking a model", async () => {
  let calls = 0;
  const outcome = await buildDeterministicCandidates({
    documentKind: "PO",
    sources: [{ sourceRevisionId: "revision-po", mimeType: "text/plain", role: "PRIMARY",
      bytes: new TextEncoder().encode("Jabil PURCHASE ORDER\nC-10003769550 14/09/2026\n1000 VND") }],
    model: { extract: async () => { calls++; throw new Error("model must not run"); } },
  });
  assert.equal(calls, 0);
  assert.equal(outcome.status, "INCOMPLETE");
  const number = outcome.candidates.find((candidate) => candidate.fieldKey === "poNumber");
  assert.equal(number?.value, "C-10003769550");
  assert.equal(number?.sourceRevisionId, "revision-po");
  assert.equal(number?.locator.textStart !== undefined, true);
});

test("critical correction and manual entry require reason and canonical money", () => {
  assert.throws(() => validateAiFieldReview({ fieldKey: "grossAmount", aiValue: "1080",
    choice: "CORRECT", value: "1090", reason: "" }));
  assert.throws(() => validateAiFieldReview({ fieldKey: "grossAmount", aiValue: "1080",
    choice: "MANUAL", value: "1,090", reason: "Checked original" }));
  const reviewed = validateAiFieldReview({ fieldKey: "grossAmount", aiValue: "1080",
    choice: "CORRECT", value: "1090", reason: "Checked original" });
  assert.equal(reviewed.value, "1090");
  assert.equal(reviewed.choice, "CORRECT");
  assert.equal(validateAiFieldReview({ fieldKey: "grossAmount", aiValue: "1080",
    choice: "ACCEPT_AI" }).value, "1080");
});

test("VAT XML/PDF pair yields one identity, and unsupported values remain incomplete", async () => {
  const xml = "<HDon><SHDon>123</SHDon><KHHDon>AA/26E</KHHDon><NLap>2026-09-14</NLap><MST>0312345678</MST><TgTCThue>1000</TgTCThue><TgTThue>80</TgTThue><TgTTTBSo>1080</TgTTTBSo></HDon>";
  const outcome = await buildDeterministicCandidates({ documentKind: "VAT", sources: [
    { sourceRevisionId: "xml", mimeType: "application/xml", role: "XML", bytes: new TextEncoder().encode(xml) },
    { sourceRevisionId: "pdf", mimeType: "application/pdf", role: "PDF", bytes: new TextEncoder().encode("unused") },
  ] });
  assert.equal(outcome.status, "READY");
  assert.equal(outcome.candidates.filter((candidate) => candidate.fieldKey === "invoiceNumber").length, 1);
  assert.equal(outcome.candidates.find((candidate) => candidate.fieldKey === "grossAmount")?.value, "1080");
  assert.ok(outcome.candidates.every((candidate) => candidate.sourceRevisionId === "xml" && candidate.locator.xmlPath));
});
