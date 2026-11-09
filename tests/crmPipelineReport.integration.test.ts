import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadPipelineReport } from "../lib/crm/pipelineData";
import { parsePipelineFilters } from "../lib/crm/pipelineReport";
import { createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";

test("pipeline report is single-source and every metric respects pilot scope on taskflow_crm_test", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb(), prefix = randomUUID(), program = `P_${prefix}`, emptyProgram = `E_${prefix}`;
  const now = new Date("2026-11-06T05:00:00Z"), closedAt = new Date("2026-10-10T05:00Z"), createdAt = new Date("2026-10-01T05:00Z");
  let otherTeamId: string | undefined;
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.programType.createMany({ data: [program, emptyProgram].map(code => ({ code, label: `${prefix} ${code}`, color: "#71717a" })) });
    await db.opportunity.delete({ where: { id: f.opportunity.id } });
    const teamU = await db.salesTeam.create({ data: { name: `${prefix} U` } }); otherTeamId = teamU.id;
    await db.client.update({ where: { id: f.client.id }, data: { responsibleTeamId: f.team.id, picAccountId: f.picAccount.id } });
    const other = await db.client.create({ data: { name: `${prefix} Other`, responsibleTeamId: teamU.id, picAccountId: f.otherAccount.id } });
    const reason = await db.crmReason.findFirstOrThrow({ where: { group: "LOST", label: "Giá" } });
    const base = { name: `${prefix} deal`, clientId: f.client.id, programTypeCode: program, expectedYear: 2026, source: "REPEAT", demandSignal: "synthetic", stage: "BIDDING", responsibleTeamId: f.team.id, picAccountId: f.picAccount.id, createdAt };
    const won = await db.opportunity.create({ data: { ...base, outcome: "WON", closedAt } });
    const lost = await db.opportunity.create({ data: { ...base, outcome: "LOST_COMPETITIVE", outcomeReasonId: reason.id, closedAt } });
    await db.opportunity.create({ data: { ...base, outcome: "CUSTOMER_CANCELLED", closedAt } });
    await db.opportunity.create({ data: { ...base, outcome: "LEGACY_UNCLASSIFIED", legacyStatus: "FAIL", closedAt } });
    const open = await db.opportunity.create({ data: { ...base, budgetMax: 500000000 } });
    await db.opportunity.create({ data: { ...base, clientId: other.id, responsibleTeamId: teamU.id, outcome: "WON", closedAt } });
    await db.task.create({ data: { title: `${prefix} Winback`, clientId: f.client.id, sourceOpportunityId: lost.id, crmKind: "WINBACK", creatorId: f.pic.id } });
    await db.task.create({ data: { title: `${prefix} overdue`, opportunityId: open.id, dueDate: new Date("2026-11-04T17:00Z"), creatorId: f.pic.id } });
    await db.task.create({ data: { title: `${prefix} done`, opportunityId: open.id, status: "DONE", dueDate: new Date("2026-11-01T17:00Z"), creatorId: f.pic.id } });
    await db.touchpoint.create({ data: { clientId: f.client.id, status: "DRAFT", kind: "CALL", occurredAt: now, createdAt: new Date("2026-11-01T05:00Z"), outcomeLevel: 4 } });
    await db.touchpoint.createMany({ data: [1, 3].map(outcomeLevel => ({ clientId: f.client.id, status: "CONFIRMED", kind: "CALL", occurredAt: closedAt, outcomeLevel })) });
    await db.touchpoint.create({ data: { clientId: other.id, status: "DRAFT", kind: "CALL", occurredAt: now, createdAt: new Date("2026-10-01T05:00Z") } });
    await db.task.create({ data: { title: `${prefix} other overdue`, clientId: other.id, dueDate: createdAt, creatorId: f.pic.id } });
    const pilot = { mode: "PROJECT_OFFICIAL" as const, pilotTeamIds: [f.team.id], plannedCutoverDate: null };
    const official = { ...pilot, mode: "OPPORTUNITY_OFFICIAL" as const };
    const filters = (extra: Record<string, string> = {}) => parsePipelineFilters({ program, ...extra });
    const load = (extra: Record<string, string> = {}, setting = pilot) => loadPipelineReport(db, filters(extra), setting, now);

    await t.test("pilot counts only its team, preserving legacy outside the denominator", async () => {
      const r = await load();
      assert.deepEqual(r.tiles.winRate, { won: 1, lost: 1, rate: 50 });
      assert.deepEqual(r.tiles.outside, { cancelled: 1, declined: 0, open: 1, legacyUnclassified: 1 });
      assert.equal(r.scope.subtitle, "Báo cáo pilot · Nguồn: Cơ hội của team pilot");
      assert.deepEqual(r.options.teams.map(x => x.id), [f.team.id]);
      assert.deepEqual(r.openPipeline.find(x => x.stage === "BIDDING"), { stage: "BIDDING", count: 1, budget: 500000000, overdueNextSteps: 1 });
      assert.deepEqual(r.endReasons.lost[0], { reasonLabel: "Giá", count: 1, mainProgramTypeCode: program, withWinback: 1, newBrief: 0 });
      assert.deepEqual(r.usage, { overdue: 1, draftCount: 1, oldestDraftDays: 5, touchpoints: 2 });
      assert.deepEqual(r.tiles.coverage, { covered: 1, total: 1, percent: 100 });
      assert.deepEqual(r.quality.map(x => x.count), [0, 0, 1, 0]);
    });
    await t.test("a FAIL Project changes no counted metric", async () => {
      const before = await load();
      await db.project.create({ data: { name: `${prefix} FAIL`, category: "CLIENT", clientId: f.client.id, ownerId: f.pic.id, status: "FAIL", type: "MICE", revenue: 900000000, onProcessAt: createdAt } });
      assert.deepEqual(await load(), before);
    });
    await t.test("official source includes both teams without Project counts", async () => {
      const r = await loadPipelineReport(db, filters(), official, now);
      assert.deepEqual(r.tiles.winRate, { won: 2, lost: 1, rate: 67 });
      assert.equal(r.scope.subtitle, "Nguồn: Cơ hội");
    });
    await t.test("last quarter excludes current closures but keeps the current open snapshot", async () => {
      const r = await load({ period: "LAST_QUARTER" });
      assert.equal(r.tiles.winRate.rate, null); assert.equal(r.openPipeline[2].count, 1);
    });
    await t.test("program/source filters are applied and unknown options sanitized", async () => {
      assert.equal((await load({ program: emptyProgram })).isEmpty, true);
      assert.equal((await load({ source: "REFERRAL" })).tiles.winRate.rate, null);
      assert.equal((await load({ program: "unknown" })).filters.programTypeCode, null);
    });
    await t.test("requested team cannot widen the pilot report, including usage and care", async () => {
      const r = await load({ team: teamU.id });
      assert.deepEqual(r.scope.teamIds, []); assert.equal(r.isEmpty, true);
      assert.equal(r.tiles.coverage.total, 0); assert.equal(r.usage.draftCount, 0); assert.equal(r.usage.overdue, 0);
    });
    await t.test("team fallback uses the persisted Opportunity PIC before the Client team", async () => {
      await db.opportunity.update({ where: { id: won.id }, data: { responsibleTeamId: null } });
      assert.equal((await load()).tiles.winRate.won, 1);
      await db.opportunity.update({ where: { id: won.id }, data: { picAccountId: null } });
      assert.equal((await load()).tiles.winRate.won, 1);
      await db.opportunity.update({ where: { id: won.id }, data: { responsibleTeamId: teamU.id } });
      assert.equal((await load()).tiles.winRate.won, 0);
      await db.opportunity.update({ where: { id: won.id }, data: { responsibleTeamId: f.team.id, picAccountId: f.picAccount.id } });
    });
    await t.test("recognized Project history classifies clients only; first wins ignore filters", async () => {
      assert.equal((await load({ client: "NEW" })).tiles.winRate.won, 1);
      const project = await db.project.create({ data: { name: `${prefix} Prior`, category: "CLIENT", clientId: f.client.id, ownerId: f.pic.id, status: "DONE", type: "MICE", revenue: 100, onProcessAt: new Date("2026-05-01T05:00Z") } });
      assert.equal((await load({ client: "NEW" })).isEmpty, true);
      assert.equal((await load({ client: "EXISTING" })).tiles.winRate.won, 1);
      await db.project.delete({ where: { id: project.id } });
    });
    await t.test("new brief attribution requires a later Opportunity and the same scoped filters", async () => {
      const later = await db.opportunity.create({ data: { ...base, createdAt: new Date("2026-10-11T05:00Z"), briefReceivedAt: new Date("2026-10-12T05:00Z"), stage: "BRIEF" } });
      assert.equal((await load()).endReasons.lost[0].newBrief, 1);
      await db.opportunity.update({ where: { id: later.id }, data: { source: "REFERRAL" } });
      assert.equal((await load({ source: "REPEAT" })).endReasons.lost[0].newBrief, 0);
    });
  } finally {
    try {
      await cleanupCrmFixture(db, prefix);
      if (otherTeamId) await db.salesTeam.deleteMany({ where: { id: otherTeamId, name: `${prefix} U` } });
      await db.programType.deleteMany({ where: { code: { in: [program, emptyProgram] } } });
    } finally { await db.$disconnect(); }
  }
});
