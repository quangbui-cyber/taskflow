import assert from "node:assert/strict";
import { test } from "node:test";
import { computePersona, PERSONA_MIN_PROJECTS } from "../lib/crm/persona";
test("persona requires two projects and respects Vietnam month and won-only budgets", () => {
  const one = { type: "MICE", executionStartAt: new Date("2026-01-31T18:00:00Z"), revenue: 100, won: true };
  assert.equal(PERSONA_MIN_PROJECTS, 2);
  assert.equal(computePersona({ projects: [one], closedOpportunities: [] }).enoughData, false);
  const result = computePersona({ projects: [one, { ...one, revenue: 200, won: false }], closedOpportunities: [{ outcome: "WON", reasonLabel: null }, { outcome: "LOST_COMPETITIVE", reasonLabel: "Giá" }] });
  assert.equal(result.enoughData, true);
  assert.deepEqual(result.typicalMonths, [2]);
  assert.deepEqual(result.programHistory, [{ code: "MICE", count: 2 }]);
  assert.deepEqual(result.budgetRange, { min: 100, max: 100 });
  assert.deepEqual(result.outcomes, { won: 1, lostCompetitive: 1, cancelled: 0, declined: 0, reasons: [{ label: "Giá", count: 1 }] });
  assert.equal(computePersona({ projects: [], closedOpportunities: [] }).budgetRange, null);
});
