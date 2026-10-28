import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { GenerationResult } from "@/lib/ai/providers/types";
import { MockGenerationModel } from "@/lib/ai/providers/mock";

const manifest = JSON.parse(
  readFileSync(new URL("./fixtures/ai/manifest.json", import.meta.url), "utf8"),
) as {
  version: string;
  fixtures: Array<{
    id: string;
    sha256: string;
    kind: string;
    content: string;
    scope: { projectId: string; allowedActorIds: string[]; sourceState: string };
    expectedSpans: Array<{
      spanId: string;
      sourceRevisionId: string;
      page: number | null;
      cellRange: string | null;
      quote: string;
    }>;
    expectedFindingCategory: "NONE" | "DETERMINISTIC_RULE" | "MODEL_SUSPICION";
    expectedConclusion: "SUPPORTED" | "INCOMPLETE" | "NO_CONCLUSION";
    prohibitedMutations: string[];
  }>;
};

function successResult(): GenerationResult {
  return {
    providerRequestId: "mock-request-001",
    output: {
      task: "DOCUMENT_EXTRACTION",
      candidates: [],
      warnings: ["No conclusion without reviewed candidate fields."],
    },
    usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
  };
}

test("synthetic fixture manifest preserves immutable hashes, scope and citation identity", () => {
  assert.equal(manifest.version, "15-12-v1");
  assert.equal(manifest.fixtures.length, 40);
  const kinds = new Set(manifest.fixtures.map((fixture) => fixture.kind));
  for (const kind of [
      "PO",
      "VAT_XML",
      "VAT_PDF",
      "IC",
      "EXCEL_UNFAMILIAR",
      "POLICY_PUBLISHED",
      "POLICY_CONFLICT",
      "UNAUTHORIZED",
      "PROMPT_INJECTION",
    ]) assert.ok(kinds.has(kind));

  for (const fixture of manifest.fixtures) {
    assert.match(fixture.id, /^[a-z0-9-]+$/);
    assert.equal(
      createHash("sha256").update(fixture.content).digest("hex"),
      fixture.sha256,
    );
    assert.ok(fixture.scope.projectId);
    assert.ok(fixture.scope.sourceState);
    assert.ok(fixture.expectedSpans.length > 0);
    assert.ok(fixture.prohibitedMutations.includes("APPROVAL"));
    assert.ok(fixture.prohibitedMutations.includes("FINANCIAL_CLOSE"));
    for (const span of fixture.expectedSpans) {
      assert.ok(span.spanId && span.sourceRevisionId && span.quote);
      assert.ok(fixture.content.includes(span.quote));
      assert.ok(span.page !== null || span.cellRange !== null);
    }
  }

  assert.ok(manifest.fixtures.some((fixture) => fixture.expectedConclusion === "NO_CONCLUSION"));
  assert.ok(manifest.fixtures.some((fixture) => fixture.expectedFindingCategory === "DETERMINISTIC_RULE"));
  assert.ok(manifest.fixtures.some((fixture) => fixture.expectedFindingCategory === "MODEL_SUSPICION"));
});

test("generation mock dequeues deterministic outcomes by task and retains usage IDs", async () => {
  const model = new MockGenerationModel([
    {
      fixtureId: "synthetic-po-clean",
      runId: "run-001",
      task: "DOCUMENT_EXTRACTION",
      outcome: { type: "success", result: successResult() },
    },
  ]);
  const fixture = manifest.fixtures[0];
  const result = await model.extract(
    {
      task: "DOCUMENT_EXTRACTION",
      instruction: "Extract only cited candidate fields.",
      authorizedSources: fixture.expectedSpans.map((span) => ({
        span,
        content: fixture.content,
      })),
    },
    new AbortController().signal,
  );

  assert.equal(result.providerRequestId, "mock-request-001");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4, totalTokens: 16 });
  assert.equal(result.output.candidates.length, 0);
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0]?.fixtureId, "synthetic-po-clean");
  assert.equal(model.calls[0]?.runId, "run-001");
});
