import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertOwnerAccess, assertTaskAccess, ownerParticipants, isValidAssignee } from "../lib/taskAccess";
import { loadCrmOwnerTargets } from "../lib/crm/ownerTargets";
import type { CrmActor } from "../lib/crm/policy";
import { createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";
test("task owner access preserves membership and enforces CRM assignment", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = randomUUID();
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const owner = { kind: "CLIENT" as const, id: f.client.id };
    const task = await db.task.create({ data: { title: "CRM task", clientId: f.client.id, creatorId: f.pic.id, assigneeId: f.assignee.id } });
    for (const user of [f.pic, f.manager, f.admin]) assert.ok("ok" in await assertOwnerAccess(db, user, owner, "CREATE_TASK"));
    assert.ok("error" in await assertOwnerAccess(db, f.outsider, owner, "CREATE_TASK"));
    assert.ok("task" in await assertTaskAccess(db, f.assignee, task.id, "EDIT"));
    assert.ok("error" in await assertTaskAccess(db, f.outsider, task.id, "EDIT"));
    assert.ok("task" in await assertTaskAccess(db, f.outsider, task.id, "VIEW"));
    assert.ok("error" in await assertTaskAccess(db, f.assignee, task.id, "DELETE"));
    const participants = await ownerParticipants(db, owner);
    for (const id of [f.pic.id, f.manager.id, f.assignee.id]) assert.ok(participants.includes(id));
    assert.equal(await isValidAssignee(db, owner, f.outsider.id), true);
    const project = await db.project.create({ data: { name: `${prefix} Project`, ownerId: f.pic.id, members: { create: { userId: f.pic.id } } } });
    const pt = await db.task.create({ data: { title: "Project task", projectId: project.id, creatorId: f.pic.id } });
    assert.ok("task" in await assertTaskAccess(db, f.pic, pt.id, "EDIT"));
    assert.ok("task" in await assertTaskAccess(db, f.admin, pt.id, "EDIT"));
    assert.ok("error" in await assertTaskAccess(db, f.outsider, pt.id, "VIEW"));
    assert.equal(await isValidAssignee(db, { kind: "PROJECT", id: project.id }, f.outsider.id), false);
    const ot = await db.task.create({ data: { title: "Opportunity task", opportunityId: f.opportunity.id, creatorId: f.pic.id } });
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { outcome: "CS_DECLINED", closedAt: new Date() } });
    assert.ok("error" in await assertTaskAccess(db, f.pic, ot.id, "EDIT"));
  } finally { try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); } }
});

test("CRM owner targets include only ASSIGN-authorized resources and disappear with flag off", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = randomUUID();
  const previousFlag = process.env.CRM_ENABLED;
  try {
    process.env.CRM_ENABLED = "true";
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id } });
    const base: CrmActor = { id: f.pic.id, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
    const targets = await loadCrmOwnerTargets(db, base);
    assert.ok(targets.clients.some((client) => client.id === f.client.id));
    assert.ok(targets.opportunities.some((opportunity) => opportunity.id === f.opportunity.id));
    const outsider = await loadCrmOwnerTargets(db, { ...base, id: f.outsider.id, accountId: null });
    assert.equal(outsider.clients.some((client) => client.id === f.client.id), false);
    assert.equal(outsider.opportunities.some((opportunity) => opportunity.id === f.opportunity.id), false);
    const manager = await loadCrmOwnerTargets(db, { ...base, id: f.manager.id, managedTeamIds: [f.team.id] });
    assert.ok(manager.clients.some((client) => client.id === f.client.id), "PIC team fallback matches policy");
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { outcome: "CS_DECLINED" } });
    assert.equal((await loadCrmOwnerTargets(db, base)).opportunities.some((opportunity) => opportunity.id === f.opportunity.id), false);
    process.env.CRM_ENABLED = "false";
    assert.deepEqual(await loadCrmOwnerTargets(db, base), { opportunities: [], clients: [] });
  } finally {
    if (previousFlag === undefined) delete process.env.CRM_ENABLED; else process.env.CRM_ENABLED = previousFlag;
    try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); }
  }
});
