import assert from "node:assert/strict";
import { test } from "node:test";
import { revenuePercentiles, revenueBandFor, computeTier, cadenceWeeksFor, compareTier, revenue24mWindow } from "../lib/crm/tier";
import { DEFAULT_CADENCE_WEEKS } from "../lib/crm/settingsSchema";
test("revenue percentile uses positive revenue only with equal-value ties", () => {
  assert.deepEqual([...revenuePercentiles(new Map([["a", 10], ["b", 20], ["c", 30], ["d", 40], ["zero", 0]]))].map(([, n]) => n), [25, 50, 75, 100]);
  assert.equal(revenuePercentiles(new Map()).size, 0);
  const tied = revenuePercentiles(new Map([["a", 20], ["b", 20]]));
  assert.equal(tied.get("a"), tied.get("b"));
});
test("unscored and unconfigured clients stay unrated; zero revenue uses configured lowest band", () => {
  const scale = [{ key: "high", label: "High" }];
  const matrix = { revenueBands: [{ key: "low", label: "Low", minPercentile: 0 }], cells: { low: { high: "A" as const } } };
  assert.equal(revenueBandFor(null, matrix.revenueBands)?.key, "low");
  const input = { potentialLevel: "high", revenueBand: "low", matrix, scale };
  assert.deepEqual(computeTier({ ...input, potentialLevel: null }), { tier: "UNRATED", reason: "NOT_SCORED" });
  assert.deepEqual(computeTier({ ...input, matrix: null }), { tier: "UNRATED", reason: "MATRIX_MISSING" });
  assert.deepEqual(computeTier(input), { tier: "A", reason: "SCORED" });
  assert.equal(cadenceWeeksFor("UNRATED", DEFAULT_CADENCE_WEEKS), 4);
  assert.ok(compareTier("UNRATED", "B") < 0);
});
test("24-month revenue window clamps leap day in Vietnam time", () => {
  const window = revenue24mWindow(new Date("2028-02-29T03:00:00Z"));
  assert.equal(window.start.toISOString(), "2026-02-28T03:00:00.000Z");
  assert.equal(window.end.toISOString(), "2028-02-29T03:00:00.000Z");
});
