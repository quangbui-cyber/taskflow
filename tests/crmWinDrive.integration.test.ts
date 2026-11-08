import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../lib/prisma";
import { winOpportunity } from "../lib/crm/opportunityWin";
import { handOverOpportunityDrive, retryOpportunityDriveHandovers } from "../lib/crm/opportunityDrive";
import { GET as driveSync } from "../app/api/cron/drive-sync/route";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("offline win rekeys the same Drive folders idempotently; cron recovers unstarted handovers and leaves open Opportunities alone", { skip: !crmTestDatabaseUrl() }, async (t) => {
  // The service uses the application's singleton; reject a mismatched environment before it can write.
  assert.ok(process.env.DATABASE_URL === crmTestDatabaseUrl(), "application singleton must target the dedicated CRM test DB");
  const db = createCrmTestDb(); const prefix = `win-drive-${randomUUID()}`;
  const folderIds = Array.from({ length: 9 }, (_, i) => `${prefix}-F${i}`);
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("No provider requests allowed in offline Drive tests"); });
  const oldFlag = process.env.CRM_ENABLED; const oldSecret = process.env.CRON_SECRET;
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
    // Verify the real cron route's authorization and feature flag before its offline retry.
    for (const [index, suffix] of ["", ":docs", ":tasks"].entries()) await db.driveFolder.update({ where: { folderId: folderIds[3 + index] }, data: { key: `opportunity:${pending.id}${suffix}` } });
    process.env.CRON_SECRET = randomUUID(); process.env.CRM_ENABLED = "true";
    assert.equal((await driveSync(new Request("http://localhost/api/cron/drive-sync"))).status, 401);
    assert.equal(await db.driveFolder.count({ where: { key: { startsWith: `opportunity:${pending.id}` } } }), 3);
    const request = () => new Request("http://localhost/api/cron/drive-sync", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    process.env.CRM_ENABLED = "false";
    const off = await driveSync(request()); assert.equal(off.status, 200);
    assert.deepEqual((await off.json()).opportunityHandovers, { retried: 0 });
    assert.equal(await db.driveFolder.count({ where: { key: { startsWith: `opportunity:${pending.id}` } } }), 3);
    process.env.CRM_ENABLED = "true";
    const on = await driveSync(request()); assert.equal(on.status, 200);
    const response = await on.json(); assert.equal(response.skipped, true); assert.equal(response.recaps, null);
    assert.ok(response.opportunityHandovers.retried >= 1);
    assert.equal(await db.driveFolder.count({ where: { key: { startsWith: `opportunity:${pending.id}` } } }), 0);
    assert.equal(await db.driveFolder.count({ where: { key: { startsWith: `opportunity:${open.id}` } } }), 3);
    assert.equal(network.mock.callCount(), 0);
  } finally {
    if (oldFlag === undefined) delete process.env.CRM_ENABLED; else process.env.CRM_ENABLED = oldFlag;
    if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret;
    await db.driveFolder.deleteMany({ where: { folderId: { in: folderIds } } });
    await cleanupCrmFixture(db, prefix); await db.$disconnect(); await prisma.$disconnect();
  }
});
