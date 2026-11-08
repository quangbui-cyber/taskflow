import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { emptyMonths, KPI_RECOGNIZED_STATUSES, kpiYearRange, vietnamYearMonth } from "../lib/kpi";
import { advanceStage, openOpportunity } from "../lib/crm/opportunityWorkflow";
import { winOpportunity } from "../lib/crm/opportunityWin";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

async function monthlyRevenue(db: PrismaClient, clientId: string) {
  const range = kpiYearRange(2026);
  const projects = await db.project.findMany({ where: {
    clientId, category: "CLIENT", status: { in: KPI_RECOGNIZED_STATUSES }, onProcessAt: { gte: range.start, lt: range.end },
  }, select: { revenue: true, onProcessAt: true } });
  const result = emptyMonths();
  for (const project of projects) if (project.onProcessAt) result[vietnamYearMonth(project.onProcessAt).month - 1] += project.revenue;
  return result;
}

test("creating and editing Opportunity budgets preserves monthly KPI; only a won contract adds revenue in its VN month", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = `kpi-win-${randomUUID()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id } });
    await db.project.createMany({ data: [
      { name: `${prefix} Existing September`, clientId: f.client.id, ownerId: f.admin.id, category: "CLIENT", type: "MICE", status: "DONE", revenue: 300, onProcessAt: new Date("2026-09-15T00:00:00+07:00") },
      { name: `${prefix} Existing October`, clientId: f.client.id, ownerId: f.admin.id, category: "CLIENT", type: "MICE", status: "ON_PROCESS", revenue: 200, onProcessAt: new Date("2026-10-02T00:00:00+07:00") },
      { name: `${prefix} Excluded pending`, clientId: f.client.id, ownerId: f.admin.id, category: "CLIENT", type: "MICE", status: "PENDING", revenue: 999, onProcessAt: new Date("2026-10-01T00:00:00+07:00") },
    ] });
    const actor = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
    const before = await monthlyRevenue(db, f.client.id);
    assert.equal(before[8], 300); assert.equal(before[9], 200);
    const opened = await openOpportunity(db, actor, { clientId: f.client.id, programTypeCode: "MICE", expectedYear: 2026, expectedMonth: 10, source: "OTHER", demandSignal: "fixture", name: `${prefix} New Opportunity`, budgetMin: 5_000_000_000, budgetMax: 5_000_000_000 });
    assert.ok("ok" in opened);
    assert.deepEqual(await monthlyRevenue(db, f.client.id), before);
    const brief = await advanceStage(db, actor, { opportunityId: opened.opportunityId, expectedVersion: 0, to: "BRIEF", briefReceivedAt: new Date("2026-10-01T00:00:00+07:00"), budgetMin: 6_000_000_000, budgetMax: 7_000_000_000 }, { notify: async () => {} });
    assert.ok("ok" in brief);
    assert.deepEqual(await monthlyRevenue(db, f.client.id), before);
    assert.ok("ok" in await advanceStage(db, actor, { opportunityId: opened.opportunityId, expectedVersion: 1, to: "BIDDING" }, { notify: async () => {} }));
    const result = await winOpportunity(db, actor, { opportunityId: opened.opportunityId, expectedVersion: 2, contractValue: 1_200_000_000, wonAt: new Date("2026-10-01T00:01:00+07:00"), projectName: `${prefix} Won` });
    assert.ok("ok" in result);
    const expected = [...before]; expected[9] += 1_200_000_000;
    assert.deepEqual(await monthlyRevenue(db, f.client.id), expected);
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: result.projectId } })).onProcessAt?.toISOString(), "2026-09-30T17:00:00.000Z");
  } finally { await cleanupCrmFixture(db, prefix); await db.$disconnect(); }
});
