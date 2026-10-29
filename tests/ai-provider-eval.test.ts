import assert from "node:assert/strict";
import test from "node:test";

import { providerFlagMetrics } from "@/scripts/ai-evals/provider";

const fixtures = [
  { id: "positive-a", expectedFindingCategory: "MODEL_SUSPICION" },
  { id: "positive-b", expectedFindingCategory: "MODEL_SUSPICION" },
  { id: "negative-a", expectedFindingCategory: "NONE" },
] as Parameters<typeof providerFlagMetrics>[0];

test("provider flag metrics keep false positives and false negatives explicit", () => {
  assert.deepEqual(providerFlagMetrics(fixtures, [
    { id: "positive-a", flagged: true },
    { id: "positive-b", flagged: false },
    { id: "negative-a", flagged: true },
  ]), {
    truePositive: 1,
    falsePositive: 1,
    falseNegative: 1,
    precision: 0.5,
    recall: 0.5,
  });
});

test("provider flag metrics report a perfect bound result", () => {
  const metrics = providerFlagMetrics(fixtures, [
    { id: "positive-a", flagged: true },
    { id: "positive-b", flagged: true },
    { id: "negative-a", flagged: false },
  ]);
  assert.equal(metrics.precision, 1);
  assert.equal(metrics.recall, 1);
});
