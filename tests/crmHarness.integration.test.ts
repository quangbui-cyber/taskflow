import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertCrmTestDb, cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("CRM harness guards the target database and cleans a complete fixture", { skip: !crmTestDatabaseUrl() }, async () => {
  for (const url of [
    "postgresql://u@127.0.0.1:55439/taskflow",
    "postgresql://u@db.example.com/taskflow_crm_test",
    "postgresql://u@127.0.0.1:55439/taskflow_crm_testevil",
    "postgresql://u@127.0.0.1:55439/taskflow_crm_test/other",
    "https://127.0.0.1/taskflow_crm_test",
    "not-a-url",
  ]) assert.throws(() => assertCrmTestDb(url));
  assert.doesNotThrow(() => assertCrmTestDb("postgresql://u@localhost:55439/taskflow_crm_test_isolated"));

  const db = createCrmTestDb();
  const prefix = randomUUID();
  try {
    const fixture = await seedCrmFixture(db, prefix);
    assert.equal(fixture.admin.role, "ADMIN");
    assert.equal(fixture.manager.role, "ACCOUNT");
    assert.equal(fixture.picAccount.userId, fixture.pic.id);
    assert.equal(fixture.otherAccount.teamId, fixture.team.id);
    const project = await db.project.create({ data: { name: `${prefix} Project`, ownerId: fixture.pic.id, clientId: fixture.client.id, accountId: fixture.picAccount.id, members: { create: { userId: fixture.assignee.id } } } });
    await cleanupCrmFixture(db, prefix);
    assert.equal(await db.project.count({ where: { id: project.id } }), 0);
    assert.equal(await db.projectMember.count({ where: { projectId: project.id } }), 0);
    assert.equal(await db.user.count({ where: { email: { startsWith: `${prefix}-` } } }), 0);
    assert.equal(await db.client.count({ where: { id: fixture.client.id } }), 0);
    assert.equal(await db.account.count({ where: { teamId: fixture.team.id } }), 0);
    assert.equal(await db.salesTeam.count({ where: { id: fixture.team.id } }), 0);
  } finally {
    try { await cleanupCrmFixture(db, prefix); }
    finally { await db.$disconnect(); }
  }
});
