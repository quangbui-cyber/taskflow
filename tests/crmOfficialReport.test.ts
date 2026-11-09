import assert from "node:assert/strict";
import test from "node:test";
import { buildRevenueWinRateView, competitiveCountsBy, opportunityReportYear, LEGACY_PIPELINE_STAGES, type ReportOpportunity } from "../lib/crm/officialReport";
import type { PipelineModeSetting } from "../lib/crm/pipelineMode";
const setting: PipelineModeSetting = { mode: "PROJECT_OFFICIAL", pilotTeamIds: [], plannedCutoverDate: null };
const projects = ["ON_PROCESS", "DONE", "FAIL", "CANCEL", "PENDING", "BIDDING"].map((status, i) => ({ id: `${i}`, status, revenue: [100, 50, 0, 0, 0, 30][i], sourceOpportunityTeamId: null }));
const opp = (outcome: string | null, stage = "BIDDING", extra: Partial<ReportOpportunity> = {}): ReportOpportunity => ({ id: "o", outcome, stage, budgetMin: null, budgetMax: null, picAccountId: "a", picAccountName: "Account", teamId: "T", clientId: "c", createdAt: new Date("2026-01-01Z"), closedAt: null, ...extra });
test("CRM off preserves legacy labels, formula and six pipeline stages", () => {
  const view = buildRevenueWinRateView({ crmOn: false, setting, projects, opportunities: [opp("WON")] });
  assert.equal(view.source, "PROJECT"); assert.equal(view.winRateLabel, "Tỷ lệ thắng"); assert.equal(view.won, 2); assert.equal(view.lost, 2); assert.equal(view.rate, 50); assert.equal(view.rateDisplay, "50%");
  assert.equal(view.caption, "2 thắng · 2 thua"); assert.equal(view.outsideLine, null); assert.equal(view.pilotBadge, null); assert.equal(view.biddingValue, 30);
  assert.deepEqual(view.pipelineStages.map((s) => s.key), LEGACY_PIPELINE_STAGES.map((s) => s.key));
});
test("pilot exclusions affect Project win rate and pipeline only", () => {
  const view = buildRevenueWinRateView({ crmOn: true, setting: { ...setting, pilotTeamIds: ["T"] }, projects: [...projects, { id: "pilot", status: "ON_PROCESS", revenue: 999, sourceOpportunityTeamId: "T" }], opportunities: [] });
  assert.equal(view.won, 2); assert.equal(view.pilotBadge, "Chưa gồm deal của team pilot"); assert.equal(view.pipelineStages.find((s) => s.key === "ON_PROCESS")?.value, 100); assert.equal(view.legacyReportProjectIds.has("pilot"), false);
});
test("Project official with no pilot is identical to CRM off", () => {
  assert.deepEqual(buildRevenueWinRateView({ crmOn: true, setting, projects, opportunities: [] }), buildRevenueWinRateView({ crmOn: false, setting, projects, opportunities: [] }));
});
test("Opportunity official uses competitive outcomes, outside counts and open budget stages only", () => {
  const opportunities = [...Array.from({ length: 5 }, () => opp("WON")), ...Array.from({ length: 3 }, () => opp("LOST_COMPETITIVE")), opp("CUSTOMER_CANCELLED"), opp("CS_DECLINED"), opp("CS_DECLINED"), opp(null, "CARE"), opp(null, "BRIEF"), opp(null, "BIDDING", { budgetMax: 100 }), opp(null, "BIDDING", { budgetMin: 50 }), opp("LEGACY_UNCLASSIFIED")];
  const view = buildRevenueWinRateView({ crmOn: true, setting: { ...setting, mode: "OPPORTUNITY_OFFICIAL" }, projects, opportunities });
  assert.equal(view.winRateLabel, "Tỷ lệ thắng cạnh tranh"); assert.equal(view.rate, 63); assert.equal(view.rateDisplay, "63%"); assert.equal(view.caption, "Thắng 5 / (Thắng 5 + Thua cạnh tranh 3)");
  assert.equal(view.outsideLine, "Khách hủy 1 · CS không tham gia 2 · Đang mở 4 · Chưa rõ kết quả 1"); assert.equal(view.biddingValue, 150); assert.equal(view.pipelineTitle, "Pipeline Cơ hội"); assert.equal(view.pilotBadge, null);
  assert.deepEqual(view.pipelineStages.map((s) => [s.key, s.label]), [["CARE", "Chăm sóc"], ["BRIEF", "Brief"], ["BIDDING", "Bidding"]]); assert.equal(view.legacyReportProjectIds.size, 0);
});
test("open-only Opportunity empty denominator has the specified copy", () => {
  const view = buildRevenueWinRateView({ crmOn: true, setting: { ...setting, mode: "OPPORTUNITY_OFFICIAL" }, projects, opportunities: [opp(null)] });
  assert.equal(view.rateDisplay, "-"); assert.equal(view.caption, "Chưa có deal phân định"); assert.equal(view.outsideLine?.includes("Chưa rõ kết quả"), false);
});
test("competitive grouping includes other outcomes only in count and skips null groups", () => {
  const counts = competitiveCountsBy([opp("WON"), opp("LOST_COMPETITIVE"), opp("CUSTOMER_CANCELLED"), opp(null, "CARE", { picAccountId: null })], (o) => o.picAccountId);
  assert.deepEqual([...counts], [["a", { won: 1, lost: 1, count: 3 }]]);
});
test("Opportunity report year uses Vietnam closedAt then createdAt", () => {
  assert.equal(opportunityReportYear(opp("WON", "BIDDING", { closedAt: new Date("2026-12-31T18:00:00Z") })), 2027);
  assert.equal(opportunityReportYear(opp(null)), 2026);
});
