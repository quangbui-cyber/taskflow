import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadReportProjects, loadReportOpportunities, loadOpportunityParticipation, countBiddingOpportunitiesByUser, resolveOfficialSource } from "../lib/crm/officialReport";
import { loadMemberContributionFrom } from "../lib/kpiData";
import { kpiYearRange } from "../lib/kpi";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";
test("official report loaders keep source teams, participation, money and feature-off query boundaries", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(), prefix = `official-${randomUUID()}`;
  let previous: Awaited<ReturnType<typeof db.crmSetting.findUnique>> = null;
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { responsibleTeamId: null, createdAt: new Date("2026-08-01Z"), budgetMax: 300 } });
    const project = await db.project.create({ data: { name: `${prefix} Project`, ownerId: f.admin.id, clientId: f.client.id, accountId: f.picAccount.id, sourceOpportunityId: f.opportunity.id, status: "ON_PROCESS", revenue: 1234, createdAt: new Date("2026-08-01Z"), onProcessAt: new Date("2026-09-01Z"), members: { create: { userId: f.assignee.id } } } });
    assert.equal((await loadReportProjects(db, { id: project.id })).get(project.id), f.team.id);
    await db.opportunityMember.create({ data: { opportunityId: f.opportunity.id, userId: f.assignee.id } });
    for (const [i, outcome] of ["LOST_COMPETITIVE", "LEGACY_UNCLASSIFIED", "CUSTOMER_CANCELLED", "WON"].entries()) await db.opportunity.create({ data: { name: `${prefix} ${i}`, clientId: f.client.id, programTypeCode: "MICE", expectedYear: 2026, source: "OTHER", demandSignal: "test", stage: "BIDDING", outcome, legacyStatus: outcome === "LEGACY_UNCLASSIFIED" ? "FAIL" : null, createdAt: new Date("2025-08-01Z"), closedAt: new Date("2026-09-01Z"), opportunityMembers: { create: { userId: f.assignee.id } } } });
    assert.deepEqual(await loadOpportunityParticipation(db, f.assignee.id, kpiYearRange(2026)), { joined: 4, failed: 2 });
    await db.opportunity.create({ data: { name: `${prefix} Care`, clientId: f.client.id, programTypeCode: "MICE", expectedYear: 2026, source: "OTHER", demandSignal: "test", stage: "CARE", createdAt: new Date("2025-01-01Z"), opportunityMembers: { create: { userId: f.assignee.id } } } });
    assert.equal((await countBiddingOpportunitiesByUser(db, [f.assignee.id, f.outsider.id])).get(f.assignee.id), 1);
    assert.equal((await countBiddingOpportunitiesByUser(db, [f.assignee.id, f.outsider.id])).get(f.outsider.id), undefined);
    const projects = await loadMemberContributionFrom(db, f.assignee.id, 2026), opportunities = await loadMemberContributionFrom(db, f.assignee.id, 2026, "OPPORTUNITY");
    assert.equal(projects.total, 1234); assert.equal(opportunities.total, projects.total); assert.deepEqual(opportunities.projects, projects.projects);
    assert.equal(opportunities.joinedCount - projects.joinedCount, 4); assert.equal(opportunities.failedCount - projects.failedCount, 2);
    const loaded = await loadReportOpportunities(db, { clientId: f.client.id });
    assert.equal(loaded.find((o) => o.id === f.opportunity.id)?.teamId, f.team.id); assert.equal(loaded.find((o) => o.id === f.opportunity.id)?.budgetMax, 300);
    const neverQuery = new Proxy(db, { get() { throw new Error("CRM off must not query"); } });
    assert.deepEqual(await resolveOfficialSource(neverQuery, false), { source: "PROJECT", setting: null });
    previous = await db.crmSetting.findUnique({ where: { key: "pipeline.mode" } }); assert.ok(previous);
    await db.crmSetting.update({ where: { key: "pipeline.mode" }, data: { value: { mode: "OPPORTUNITY_OFFICIAL", pilotTeamIds: [f.team.id], plannedCutoverDate: null }, version: { increment: 1 } } });
    assert.equal((await resolveOfficialSource(db, true)).source, "OPPORTUNITY");
  } finally {
    if (previous) await db.crmSetting.update({ where: { key: "pipeline.mode" }, data: { value: previous.value!, version: previous.version, updatedAt: previous.updatedAt, updatedById: previous.updatedById } });
    await cleanupCrmFixture(db, prefix); await db.$disconnect();
  }
});

