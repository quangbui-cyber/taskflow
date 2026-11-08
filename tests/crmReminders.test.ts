import assert from "node:assert/strict";
import { test } from "node:test";
import { eventAnchorDate, planReminderSteps, rescheduleSteps, pickConsolidationTarget, type EventTiming } from "../lib/crm/reminders";
const vn = (s: string) => new Date(`${s}T00:00:00+07:00`);
const timing: EventTiming = { precision: "DAY", year: 2026, month: 12, quarter: null, date: vn("2026-12-20") };
test("day offsets, past collapse and no after-event reminders", () => {
  assert.deepEqual(planReminderSteps(timing, [90, 60, 30], vn("2026-08-01")).map((s) => s.dueDate), [vn("2026-09-21"), vn("2026-10-21"), vn("2026-11-20")]);
  const late = planReminderSteps(timing, [90, 60, 30], vn("2026-11-01"));
  assert.deepEqual(late.map((s) => [s.offsetDays, s.dueDate]), [[60, vn("2026-11-01")], [30, vn("2026-11-20")]]);
  assert.deepEqual(planReminderSteps(timing, [30], vn("2026-12-21")), []);
  assert.equal(planReminderSteps(timing, [30, 30, 0, 366], vn("2026-08-01")).length, 1);
});
test("month anchors on day one; quarter creates one verification", () => {
  assert.deepEqual(eventAnchorDate({ ...timing, precision: "MONTH", year: 2027, month: 3 }), vn("2027-03-01"));
  const quarter = { ...timing, precision: "QUARTER" as const, year: 2027, quarter: 2, date: null };
  assert.equal(eventAnchorDate(quarter), null);
  assert.deepEqual(planReminderSteps(quarter, [45, 21], vn("2027-01-01")), [{ kind: "VERIFY_MONTH", offsetDays: null, dueDate: vn("2027-02-15") }]);
});
test("rescheduling preserves done, retargets open and replaces planned", () => {
  const next = planReminderSteps(timing, [90, 60, 30], vn("2026-08-01"));
  const result = rescheduleSteps([
    { id: "planned", kind: "OFFSET", offsetDays: 90, status: "PLANNED", taskId: null },
    { id: "done", kind: "OFFSET", offsetDays: 60, status: "DONE", taskId: "done-task" },
    { id: "open", kind: "OFFSET", offsetDays: 30, status: "OPEN", taskId: "task" },
  ], next);
  assert.deepEqual(result.supersedeIds, ["planned"]);
  assert.deepEqual(result.retarget, [{ stepId: "open", taskId: "task", dueDate: vn("2026-11-20") }]);
  assert.deepEqual(result.create.map((s) => s.offsetDays), [90]);
});
test("consolidation selects matching opportunity then unscoped client/program; never a different deal", () => {
  const step = { clientId: "c", opportunityId: "opp", programTypeCode: "MICE" };
  const base = { crmKind: "NEXT_STEP", opportunityId: null, clientId: "c", programTypeCode: "MICE", dueDate: null };
  assert.equal(pickConsolidationTarget([{ ...base, id: "fallback" }, { ...base, id: "exact", opportunityId: "opp" }], step), "exact");
  assert.equal(pickConsolidationTarget([{ ...base, id: "fallback" }], step), "fallback");
  assert.equal(pickConsolidationTarget([{ ...base, id: "other", opportunityId: "another" }], step), null);
});
