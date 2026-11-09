import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadOpenOpportunityDialogOptions, loadTouchpointDialogOptions } from "../lib/crm/dialogOptions";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("CRM dialog options reflect persisted owners and carry no private content", { skip: !crmTestDatabaseUrl() }, async t => {
  const db = createCrmTestDb(); const prefix = `dialogs-${randomUUID()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const actor = (u: typeof f.pic) => ({ id: u.id, role: u.role, accountId: u.id === f.pic.id ? f.picAccount.id : null, managedTeamIds: [] as string[], isDataSteward: false });
    const closed = await db.opportunity.create({ data: { name: `${prefix} Closed`, clientId: f.client.id, programTypeCode: "MICE", expectedYear: 2027, source: "OTHER", demandSignal: "private signal", outcome: "CUSTOMER_CANCELLED" } });
    await t.test("PIC sees owned client and open Opportunity only; outsider and denied filter see no client", async () => {
      const opts = await loadTouchpointDialogOptions(db, actor(f.pic), {});
      const client = opts.clients.find(c => c.id === f.client.id); assert.ok(client);
      assert.deepEqual(client.openOpportunities.map(o => o.id), [f.opportunity.id]); assert.ok(!client.openOpportunities.some(o => o.id === closed.id));
      assert.equal((await loadTouchpointDialogOptions(db, actor(f.outsider), { clientId: f.client.id })).clients.length, 0);
      assert.ok(!JSON.stringify(opts).includes("private signal")); assert.ok(!JSON.stringify(opts).includes("budgetMin"));
      assert.ok(opts.programTypes.some(p => p.code === "YEP"));
    });
    await t.test("own Client/Opportunity task grants option with matching completion context only", async () => {
      const task = await db.task.create({ data: { title: "Own task", clientId: f.client.id, creatorId: f.pic.id, assigneeId: f.assignee.id } });
      const opts = await loadTouchpointDialogOptions(db, actor(f.assignee), { clientId: f.client.id }); assert.equal(opts.clients.length, 1);
      assert.ok(opts.clients[0].assignedTasks.some(row => row.id === task.id && row.opportunityId === null)); assert.equal(opts.clients[0].canLogClient, false);
      await db.task.update({ where: { id: task.id }, data: { clientId: null, opportunityId: f.opportunity.id } });
      assert.equal((await loadTouchpointDialogOptions(db, actor(f.assignee), {})).clients.find(c => c.id === f.client.id)?.assignedTasks[0].opportunityId, f.opportunity.id);
      await db.opportunity.update({ where: { id: f.opportunity.id }, data: { outcome: "CUSTOMER_CANCELLED" } });
      assert.equal((await loadTouchpointDialogOptions(db, actor(f.assignee), { clientId: f.client.id })).clients.length, 0);
      await db.opportunity.update({ where: { id: f.opportunity.id }, data: { outcome: null } });
    });
    await t.test("open Opportunity options require client EDIT and include active OUTING/YEP", async () => {
      for (const user of [f.pic, f.admin]) assert.equal((await loadOpenOpportunityDialogOptions(db, actor(user), { clientId: f.client.id })).clients.length, 1);
      assert.equal((await loadOpenOpportunityDialogOptions(db, actor(f.assignee), { clientId: f.client.id })).clients.length, 0);
      const opts = await loadOpenOpportunityDialogOptions(db, actor(f.pic), {});
      for (const code of ["OUTING", "YEP"]) assert.ok(opts.programTypes.some(p => p.code === code));
      assert.equal(opts.clients.find(c => c.id === f.client.id)?.picAccountId, f.picAccount.id);
      await db.user.update({ where: { id: f.outsider.id }, data: { isActive: false } });
      assert.ok(!(await loadTouchpointDialogOptions(db, actor(f.pic), {})).users.some(u => u.id === f.outsider.id));
    });
    await t.test("Opportunity PIC can log its own deal without inheriting Client or sibling rights", async () => {
      await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.otherAccount.id } });
      const other = await db.opportunity.create({ data: { name: `${prefix} Sibling`, clientId: f.client.id, programTypeCode: "MICE", expectedYear: 2027, source: "OTHER", demandSignal: "test", picAccountId: f.otherAccount.id } });
      const opts = await loadTouchpointDialogOptions(db, actor(f.pic), { clientId: f.client.id });
      assert.equal(opts.clients.length, 1); assert.equal(opts.clients[0].canLogClient, false);
      assert.equal(opts.clients[0].openOpportunities.find(o => o.id === f.opportunity.id)?.canLog, true);
      assert.equal(opts.clients[0].openOpportunities.find(o => o.id === other.id)?.canLog, false);
      assert.equal(opts.clients[0].assignedTasks.length, 0);
    });
  } finally { try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); } }
});
