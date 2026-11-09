import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyWinRate } from "../lib/crm/metrics";
import { buildSnapshotReport, compareRevenueInvariant, failedCountByUserYear, pipelineComparison, projectAfterMigration, recognizedRevenueByMonth, reconciliationToCsv, reconciliationToJson, winRateCauses, type ReconciliationInput, type ReconciliationProject } from "../lib/crm/reconciliation";
import type { LegacyPlan } from "../lib/crm/legacyMigration";

const date = new Date("2026-10-01T00:00:00Z");
function fixture(): ReconciliationInput {
  const project = (id: string, status: string, extra: Partial<ReconciliationProject> = {}): ReconciliationProject => ({ id, name: id, status, category: "CLIENT", revenue: 100, createdAt: date, onProcessAt: null, completedAt: null, sourceOpportunityId: null, sourceOpportunityTeamId: null, memberUserIds: ["u"], accountId: null, type: "EVENT", clientId: "c", ownerId: "u", executionStartAt: null, executionEndAt: null, ...extra });
  return { pipelineMode: { mode: "PROJECT_OFFICIAL", pilotTeamIds: ["T"], plannedCutoverDate: null }, projects: [project("linked", "ON_PROCESS", { onProcessAt: date, sourceOpportunityId: "won", sourceOpportunityTeamId: "T" }), project("old", "ON_PROCESS", { onProcessAt: date }), project("done", "DONE", { onProcessAt: date }), project("cancelled", "CANCEL", { onProcessAt: date }), project("fail", "FAIL"), project("cancel", "CANCEL"), project("bid", "BIDDING", { revenue: 500_000_000 }), project("pending", "PENDING")], opportunities: [{ id: "won", stage: "BIDDING", outcome: "WON", legacyStatus: null, legacyProjectId: null, budgetMin: null, budgetMax: 100, closedAt: date, createdAt: date, responsibleTeamId: "T", memberUserIds: ["u"] }] };
}
function plan(input: ReconciliationInput): LegacyPlan {
  return { generatedAt: date, totals: { MIGRATE: 3, NEEDS_REVIEW: 0, BLOCKED: 0, MISSING_CLIENT: 0 }, rows: input.projects.filter((p) => ["fail", "cancel", "bid"].includes(p.id)).map((p) => ({ projectId: p.id, name: p.name, status: p.status, classification: "MIGRATE", reasons: [], hasChatSpace: false, counts: { tasks: 2, files: 1, meetings: 1, members: 1, wishes: 1, notifications: 0, driveKeys: 0 } })) };
}
test("six causes use the official legacy calculation and projected unclassified outcomes", () => {
  const input = fixture(); input.pipelineMode.pilotTeamIds = [];
  const result = winRateCauses(input, undefined, plan(input));
  assert.deepEqual(result.legacy, legacyWinRate(input.projects));
  assert.equal(result.causes.length, 6);
  for (const [key, count] of [["CANCEL_AFTER_WIN", 1], ["WON_BEFORE_CRM", 2], ["LEGACY_UNCLASSIFIED", 2]] as const) assert.equal(result.causes.find((c) => c.key === key)?.count, count);
  assert.deepEqual(result.competitive, { won: 1, lost: 0, rate: 100 });
});
test("pilot exclusion only changes legacy reporting, never recognized revenue", () => {
  const input = fixture(), result = winRateCauses(input);
  assert.equal(result.causes.find((c) => c.key === "PILOT_EXCLUDED")?.count, 1);
  assert.equal(result.legacy.won, 2);
  assert.equal(recognizedRevenueByMonth(input, 2026)["2026-10"], 300);
});
test("projected open Bidding budget preserves old Bidding value", () => {
  const before = fixture(), after = projectAfterMigration(before, plan(before));
  const result = pipelineComparison(before, after);
  assert.equal(result.oldBiddingValue, 500_000_000);
  assert.equal(result.newByStage.find((s) => s.stage === "BIDDING")?.budget, 500_000_000);
  assert.equal(result.diff, 0);
});
test("recognized month uses Vietnam time and excludes FAIL", () => {
  const input = fixture(); input.projects = input.projects.filter((p) => ["old", "fail"].includes(p.id));
  for (const p of input.projects) p.onProcessAt = new Date("2026-09-30T17:30:00Z");
  assert.equal(recognizedRevenueByMonth(input, 2026)["2026-10"], 100);
  assert.equal(recognizedRevenueByMonth(input, 2026)["2026-09"], 0);
});
test("invariant reports exact month differences, including a single VND", () => {
  const months = recognizedRevenueByMonth(fixture(), 2026);
  assert.equal(compareRevenueInvariant(months, { ...months }).equal, true);
  const mismatch = compareRevenueInvariant(months, { ...months, "2026-10": months["2026-10"] + 1 });
  assert.equal(mismatch.equal, false);
  assert.deepEqual(mismatch.months.filter((m) => m.before !== m.after), [{ month: "2026-10", before: 300, after: 301 }]);
});
test("failedCount tracks removed Project FAIL by user/year while official KPI participation remains", () => {
  const input = fixture(); input.projects.push({ ...input.projects.find((p) => p.id === "fail")!, id: "fail2" });
  const migration = plan(input); migration.rows.push({ ...migration.rows[0], projectId: "fail2", status: "FAIL" });
  const after = projectAfterMigration(input, migration);
  assert.deepEqual(failedCountByUserYear(input), [{ userId: "u", year: 2026, failedCount: 2 }]);
  assert.deepEqual(failedCountByUserYear(after), []);
  const report = buildSnapshotReport({ input, plan: migration, year: 2026 }, after, { phase: "POST_APPLY", batchId: "b" });
  assert.equal(report.failedCountChange[0].diff, -2);
  assert.equal(report.kpiRevenueInvariant.equal, true);
  assert.equal(report.officialFailedCountChange[0].diff, 0);
});
test("CSV has BOM, escapes quotes/commas and neutralizes formula cells", () => {
  const input = fixture(), migration = plan(input); migration.rows[0].name = '=HYPERLINK("x,y")';
  const report = buildSnapshotReport({ input, plan: migration, year: 2026 }, input, { phase: "DRY_RUN", batchId: "b" });
  const csv = reconciliationToCsv(report);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=HYPERLINK(""x,y"")"'));
});
test("JSON preserves all sections and report lists classification/relation exclusions", () => {
  const input = fixture(), migration = plan(input); migration.rows[0].hasChatSpace = true;
  const report = buildSnapshotReport({ input, plan: migration, year: 2026 }, projectAfterMigration(input, migration), { phase: "DRY_RUN", batchId: "b" });
  assert.deepEqual(Object.keys(JSON.parse(reconciliationToJson(report))), Object.keys(report));
  assert.equal(report.notMigrated.googleChatSpaces.length, 1);
  assert.equal(report.notMigrated.projectWishes.length, 3);
  assert.equal(report.moved.tasks, 6);
});
