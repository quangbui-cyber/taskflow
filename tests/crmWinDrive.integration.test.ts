import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../lib/prisma";
import { winOpportunity } from "../lib/crm/opportunityWin";
import { handOverOpportunityDrive, retryOpportunityDriveHandovers } from "../lib/crm/opportunityDrive";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("offline win rekeys the same Drive folders idempotently; cron recovers unstarted handovers and leaves open Opportunities alone", { skip: !crmTestDatabaseUrl() }, async (t) => {
  // The service uses the application's singleton; reject a mismatched environment before it can write.
  assert.ok(process.env.DATABASE_URL === crmTestDatabaseUrl(), "application singleton must target the dedicated CRM test DB");
  const db = createCrmTestDb(); const prefix = `win-drive-${randomUUID()}`;
  const folderIds = Array.from({ length: 9 }, (_, i) => `${prefix}-F${i}`);
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("No provider requests allowed in offline Drive tests"); });
  try {
    assert.equal(await db.googleDriveConnection.count(), 0, "isolated DB must not have Drive credentials");
    const f = await seedCrmFixture(db, prefix);
    const actor = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
    const createOpportunity = (suffix: string) => db.opportunity.create({ data: { name: `${prefix} ${suffix}`, clientId: f.client.id, stage: "BIDDING", programTypeCode: "MICE", expectedYear: 2026, demandSignal: "test", source: "OTHER", picAccountId: f.picAccount.id } });
    const pending = await createOpportunity("Pending handover"); const open = await createOpportunity("Open");
    const opportunities = [f.opportunity, pending, open];
    for (let i = 0; i < opportunities.length; i++) {
      await db.driveFolder.createMany({ data: ["", ":docs", ":tasks"].map((suffix, j) => ({ key: `opportunity:${opportunities[i].id}${suffix}`, folderId: folderIds[i * 3 + j], name: `${prefix} Folder` })) });
    }
    const win = (id: string) => winOpportunity(db, actor, { opportunityId: id, expectedVersion: 0, contractValue: 100, wonAt: new Date("2026-10-15T00:00:00+07:00"), projectName: `${prefix} Project ${id}` });
    const first = await win(f.opportunity.id); assert.ok("ok" in first);
    await handOverOpportunityDrive(f.opportunity.id, first.projectId);
    const keys = (projectId: string) => ["", ":docs", ":tasks"].map((suffix) => `project:${projectId}${suffix}`);
    const firstRows = await db.driveFolder.findMany({ where: { key: { in: keys(first.projectId) } }, orderBy: { key: "asc" } });
    assert.equal(firstRows.length, 3); assert.deepEqual(firstRows.map((row) => row.folderId).sort(), folderIds.slice(0, 3).sort());
    assert.equal(await db.driveFolder.count({ where: { key: { startsWith: `opportunity:${f.opportunity.id}` } } }), 0);
    await handOverOpportunityDrive(f.opportunity.id, first.projectId);
    assert.deepEqual(await db.driveFolder.findMany({ where: { key: { in: keys(first.projectId) } }, orderBy: { key: "asc" } }), firstRows);
    const second = await win(pending.id); assert.ok("ok" in second);
    assert.equal(await db.driveFolder.count({ where: { key: { startsWith: `opportunity:${pending.id}` } } }), 3);
    assert.deepEqual(await retryOpportunityDriveHandovers(Date.now() - 1), { retried: 0 });
    const retry = await retryOpportunityDriveHandovers(Date.now() + 30_000); assert.ok(retry.retried >= 1);
    const retried = await db.driveFolder.findMany({ where: { key: { in: keys(second.projectId) } } });
    assert.equal(retried.length, 3); assert.deepEqual(retried.map((row) => row.folderId).sort(), folderIds.slice(3, 6).sort());
    assert.equal(await db.driveFolder.count({ where: { key: { startsWith: `opportunity:${pending.id}` } } }), 0);
    assert.equal(await db.driveFolder.count({ where: { key: { startsWith: `opportunity:${open.id}` } } }), 3);
    assert.equal(network.mock.callCount(), 0);
  } finally {
    await db.driveFolder.deleteMany({ where: { folderId: { in: folderIds } } });
    await cleanupCrmFixture(db, prefix); await db.$disconnect(); await prisma.$disconnect();
  }
});
