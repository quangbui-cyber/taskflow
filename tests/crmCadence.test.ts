import assert from "node:assert/strict";
import { test } from "node:test";
import { nextCadenceDueDate, isCadenceDue, cadencePeriodKey } from "../lib/crm/cadence";
test("confirmed touchpoint or creation anchors cadence, event and open work take priority", () => {
  const input = { lastConfirmedAt: new Date("2026-10-01T03:00:00Z"), clientCreatedAt: new Date("2026-09-01T03:00:00Z"), cadenceWeeks: 4, hasOpenCrmTask: false, hasActiveEventStepInWindow: false, weekEnd: new Date("2026-11-01") };
  assert.equal(isCadenceDue(input), true);
  assert.equal(isCadenceDue({ ...input, hasOpenCrmTask: true }), false);
  assert.equal(isCadenceDue({ ...input, hasActiveEventStepInWindow: true }), false);
  assert.equal(nextCadenceDueDate(null, input.clientCreatedAt, 4).toISOString(), "2026-09-28T17:00:00.000Z");
  assert.equal(cadencePeriodKey(new Date("2026-11-11")), "cadence:2026-11-09");
  assert.equal(isCadenceDue({ ...input, weekEnd: nextCadenceDueDate(input.lastConfirmedAt, input.clientCreatedAt, 4) }), false);
});
