import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSeasonGrid, eventTimingLabel, reminderStepStatusLabel, SEASON_CHIP_CLASSES, type SeasonEventInput } from "../lib/crm/seasonGrid";
const vn = (s: string) => new Date(`${s}T00:00:00+07:00`);
const now = vn("2026-01-01");
const programTypes = [{ code: "MICE", label: "Hội nghị", color: "#000", active: true }];
const event = (patch: Partial<SeasonEventInput> = {}): SeasonEventInput => ({ id: "event", programTypeCode: "MICE", precision: "MONTH", year: 2026, month: 7, quarter: null, date: null, source: "CLIENT_CONFIRMED", status: "ACTIVE", revision: 2, buyingUnitName: "HR", note: null, steps: [], ...patch });
const grid = (events: SeasonEventInput[] = []) => buildSeasonGrid({ projects: [], events, programTypes, now });
test("always returns twelve months, including empty input", () => {
  assert.deepEqual(grid().map(m => [m.month, m.chips]), Array.from({ length: 12 }, (_, i) => [i + 1, []]));
});
test("recognized history uses execution then fallback in VN month and year", () => {
  const months = buildSeasonGrid({ projects: [
    { id: "a", name: "Conference", type: "MICE", executionStartAt: vn("2025-12-05"), onProcessAt: null },
    { id: "b", name: "Fallback", type: "MICE", executionStartAt: null, onProcessAt: new Date("2025-11-30T17:30:00Z") },
  ], events: [], programTypes, now });
  assert.equal(months[10].chips.length, 0);
  assert.equal(months[11].chips.length, 2);
  assert.ok(months[11].chips.every(c => c.kind === "DONE" && c.className === "bg-zinc-900 text-white" && c.label === "Hội nghị 25"));
  assert.deepEqual(months[11].chips.map(c => c.projectId), ["a", "b"]);
});
test("quarter, month and day place chips without inventing quarter dates", () => {
  const quarter = event({ precision: "QUARTER", month: null, quarter: 2 });
  const day = event({ id: "day", precision: "DAY", month: 9, date: vn("2026-09-15") });
  const months = grid([quarter, event(), day]);
  assert.equal(months[3].chips[0].label, "Hội nghị Q2?");
  assert.equal(eventTimingLabel(quarter), "Quý 2/2026");
  assert.equal(months[6].chips[0].timingLabel, "Tháng 7/2026");
  assert.equal(months[8].chips[0].timingLabel, "15/09/2026");
  assert.equal(grid([event({ year: 2027 })])[6].chips[0].label, "Hội nghị 27");
});
test("includes active and brief received events, excludes cancelled and passed", () => {
  const chips = grid([event(), event({ id: "brief", status: "BRIEF_RECEIVED" }), event({ id: "cancel", status: "CANCELLED" }), event({ id: "past", status: "PASSED" })])[6].chips;
  assert.deepEqual(chips.map(c => c.eventId), ["event", "brief"]);
});
test("source classes and source priority follow the spec, history first", () => {
  const months = buildSeasonGrid({ projects: [{ id: "p", name: "P", type: "MICE", executionStartAt: vn("2026-07-01"), onProcessAt: null }], events: [event({ id: "i", source: "INDUSTRY_SEASON" }), event({ id: "h", source: "HISTORY" }), event()], programTypes, now });
  assert.deepEqual(months[6].chips.map(c => c.kind === "DONE" ? "DONE" : c.edit!.source), ["DONE", "CLIENT_CONFIRMED", "HISTORY", "INDUSTRY_SEASON"]);
  assert.equal(SEASON_CHIP_CLASSES.CLIENT_CONFIRMED, "bg-emerald-50 text-emerald-700");
  assert.equal(SEASON_CHIP_CLASSES.HISTORY, "bg-white border border-dashed border-zinc-400 text-zinc-600");
  assert.equal(SEASON_CHIP_CLASSES.INDUSTRY_SEASON, "bg-white border border-dashed border-zinc-300 text-zinc-500");
});
test("only current revision non-superseded steps, sorted by date with status labels", () => {
  const step = { id: "s", kind: "OFFSET", offsetDays: 30, dueDate: vn("2026-06-01"), status: "PLANNED", revision: 2 };
  const chips = grid([event({ steps: [step, { ...step, id: "old", revision: 1 }, { ...step, id: "super", status: "SUPERSEDED" }, { ...step, id: "done", status: "DONE", dueDate: vn("2026-05-01") }, { ...step, id: "closed", kind: "VERIFY_MONTH", offsetDays: null, status: "CLOSED", dueDate: vn("2026-07-01") }] })])[6].chips;
  assert.deepEqual(chips[0].steps, [
    { label: "30 ngày trước", dueLabel: "01/05", statusLabel: "Đã làm" },
    { label: "30 ngày trước", dueLabel: "01/06", statusLabel: "Sắp tới" },
    { label: "Xác minh tháng", dueLabel: "01/07", statusLabel: "Đã đóng" },
  ]);
  assert.equal(reminderStepStatusLabel("OPEN"), "Sắp tới");
});
test("event chips never offer an Opportunity creation action", () => {
  for (const chip of grid([event({ source: "INDUSTRY_SEASON" })])[6].chips) assert.equal("openOpportunity" in chip, false);
});
