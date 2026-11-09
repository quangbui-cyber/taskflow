import assert from "node:assert/strict";
import { test } from "node:test";
import * as report from "../lib/crm/pipelineReport";
import { OUTCOME_LEVELS } from "../lib/crm/labels";
const now = new Date("2026-11-06T05:00:00Z");
const setting = { mode: "PROJECT_OFFICIAL" as const, pilotTeamIds: ["T"], plannedCutoverDate: null };

test("pipeline periods use half-open VN calendar boundaries including year rollover", () => {
  const range = (key: report.PipelinePeriodKey, date = now) => {
    const { start, end } = report.resolvePipelinePeriod(key, date);
    return [start.toISOString(), end.toISOString()];
  };
  assert.deepEqual(range("THIS_QUARTER"), ["2026-09-30T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
  assert.deepEqual(range("LAST_QUARTER"), ["2026-06-30T17:00:00.000Z", "2026-09-30T17:00:00.000Z"]);
  assert.deepEqual(range("THIS_YEAR"), ["2025-12-31T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
  assert.deepEqual(range("THIS_QUARTER", new Date("2026-12-31T17:30Z")), ["2026-12-31T17:00:00.000Z", "2027-03-31T17:00:00.000Z"]);
  assert.deepEqual(range("LAST_QUARTER", new Date("2026-01-01T00:00Z")), ["2025-09-30T17:00:00.000Z", "2025-12-31T17:00:00.000Z"]);
});
test("filters whitelist scalar values and produce a stable canonical key", () => {
  const defaults = report.parsePipelineFilters({});
  assert.deepEqual(defaults, { period: "THIS_QUARTER", client: "ALL", teamId: null, programTypeCode: null, source: null, key: "period=THIS_QUARTER" });
  assert.deepEqual(report.parsePipelineFilters({ period: "bad", client: ["NEW"], team: "x".repeat(65), program: ["MICE"], source: "bad" }), defaults);
  assert.deepEqual(report.parsePipelineFilters({ source: ["REPEAT"], period: ["THIS_YEAR"], client: "bad" }), defaults);
  const filters = report.parsePipelineFilters({ period: "LAST_QUARTER", client: "NEW", team: "T", program: "MICE", source: "REPEAT" });
  assert.equal(filters.key, "period=LAST_QUARTER&client=NEW&team=T&program=MICE&source=REPEAT");
});
test("pilot scope cannot be widened with a foreign team", () => {
  assert.deepEqual(report.pipelineScope(setting, null), { teamIds: ["T"], subtitle: "Báo cáo pilot · Nguồn: Cơ hội của team pilot", pilotOnly: true });
  assert.deepEqual(report.pipelineScope(setting, "U").teamIds, []);
  assert.deepEqual(report.pipelineScope(setting, "T").teamIds, ["T"]);
  assert.deepEqual(report.pipelineScope({ ...setting, mode: "OPPORTUNITY_OFFICIAL" }, null), { teamIds: null, subtitle: "Nguồn: Cơ hội", pilotOnly: false });
  assert.equal(report.pipelineScope({ ...setting, pilotTeamIds: [] }, null).teamIds, null);
  assert.deepEqual(report.pipelineScope({ ...setting, mode: "OPPORTUNITY_OFFICIAL" }, "U").teamIds, ["U"]);
});
test("new clients have no win before the period start", () => {
  const start = report.resolvePipelinePeriod("THIS_QUARTER", now).start;
  assert.equal(report.isNewClient(null, start), true);
  assert.equal(report.isNewClient(new Date(start.getTime() - 1), start), false);
  assert.equal(report.isNewClient(start, start), true);
  assert.equal(report.isNewClient(now, start), true);
});
test("win-rate captions distinguish an empty denominator", () => {
  assert.deepEqual(report.winRateTile({ won: 5, lost: 3, rate: 63 }), { value: "63%", caption: "Thắng 5 · Thua cạnh tranh 3" });
  assert.deepEqual(report.winRateTile({ won: 0, lost: 0, rate: null }), { value: "-", caption: "Chưa có deal phân định" });
});
test("outside tile preserves separate cancellations, declines, open and legacy counts", () => {
  const input = { cancelled: 1, declined: 2, open: 4, legacyUnclassified: 0 };
  assert.deepEqual(report.outsideTile(input), { value: 3, caption: "Khách hủy 1 · CS không tham gia 2 · Đang mở 4" });
  assert.equal(report.outsideTile({ ...input, legacyUnclassified: 2 }).caption, "Khách hủy 1 · CS không tham gia 2 · Đang mở 4 · Chưa rõ kết quả 2");
});
test("end reasons group by outcome and reason with deterministic primary program", () => {
  const row = { outcome: "LOST_COMPETITIVE", reasonLabel: "Giá", programTypeCode: "YEP", hasWinback: false, becameNewBrief: false };
  const result = report.endReasonTables([
    row, { ...row, programTypeCode: "MICE", hasWinback: true, becameNewBrief: true },
    { ...row, reasonLabel: "Ý tưởng" }, { ...row, reasonLabel: null },
    { ...row, outcome: "CUSTOMER_CANCELLED" }, { ...row, outcome: "CS_DECLINED" },
    { ...row, outcome: "WON" }, { ...row, outcome: "LEGACY_UNCLASSIFIED" },
  ]);
  assert.deepEqual(result.lost[0], { reasonLabel: "Giá", count: 2, mainProgramTypeCode: "MICE", withWinback: 1, newBrief: 1 });
  assert.deepEqual(result.lost.slice(1).map((r) => r.reasonLabel), ["Chưa ghi lý do", "Ý tưởng"]);
  assert.deepEqual(result.cancelled, [{ reasonLabel: "Giá", count: 1 }]);
  assert.deepEqual(result.declined, [{ reasonLabel: "Giá", count: 1 }]);
});
test("usage reports oldest draft age in VN calendar days and empty drafts", () => {
  assert.deepEqual(report.usageSummary({ overdueTasks: 4, drafts: [{ createdAt: new Date("2026-10-27T05:00Z") }, { createdAt: new Date("2026-11-03T05:00Z") }], touchpoints: 12, now }), { overdue: 4, draftCount: 2, oldestDraftDays: 10, touchpoints: 12 });
  assert.equal(report.usageSummary({ overdueTasks: 0, drafts: [], touchpoints: 0, now }).oldestDraftDays, null);
  assert.equal(report.usageSummary({ overdueTasks: 0, drafts: [{ createdAt: new Date("2026-11-05T16:59Z") }], touchpoints: 0, now: new Date("2026-11-05T17:01Z") }).oldestDraftDays, 1);
});
test("quality bars retain all four labels and scale to the largest count", () => {
  const bars = report.qualityBars({ 1: 10, 2: 6, 3: 3, 4: 1 });
  assert.deepEqual(bars.map((b) => b.label), OUTCOME_LEVELS.map((l) => l.label));
  assert.deepEqual(bars.map((b) => b.percent), [100, 60, 30, 10]);
  assert.deepEqual(report.qualityBars({ 1: 0, 2: 0, 3: 0, 4: 0 }).map((b) => b.percent), [0, 0, 0, 0]);
});
test("report exports omit unmeasured usage metrics", () => {
  assert.equal(Object.keys(report).some((key) => /reviewDuration|quickLog/.test(key)), false);
});
