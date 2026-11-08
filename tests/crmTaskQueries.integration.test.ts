import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { computePerf } from "../lib/performance";
import { myOpenTasksWhere, assignedByMeOpenWhere, digestCrmTasksWhere, teamMemberOpenTasksWhere } from "../lib/taskQueries";
import { createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";
test("automatic cancellation never changes performance counts", () => {
  assert.deepEqual(computePerf([{ status: "CANCELLED", dueDate: new Date("2020-01-01"), completedAt: new Date() }]), { onTime: 0, late: 0, overdueOpen: 0, inProgress: 0, todo: 0, done: 0, total: 0 });
});
test("open tasks include CRM only with flag and exclude closed owners/statuses", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = randomUUID();
  try {
    const f = await seedCrmFixture(db, prefix);
    const base = { title: "Test", creatorId: f.manager.id, assigneeId: f.pic.id, dueDate: new Date("2026-10-01") };
    const clientTask = await db.task.create({ data: { ...base, clientId: f.client.id } });
    const oppTask = await db.task.create({ data: { ...base, opportunityId: f.opportunity.id } });
    const cancelled = await db.task.create({ data: { ...base, clientId: f.client.id, status: "CANCELLED" } });
    const project = await db.project.create({ data: { name: `${prefix} Project`, ownerId: f.pic.id, status: "ON_PROCESS", members: { create: { userId: f.pic.id } } } });
    const projectTask = await db.task.create({ data: { ...base, projectId: project.id } });
    const ids = async (crmOn: boolean) => (await db.task.findMany({ where: myOpenTasksWhere(f.pic.id, crmOn) })).map(({ id }) => id);
    assert.deepEqual(new Set(await ids(true)), new Set([clientTask.id, oppTask.id, projectTask.id]));
    assert.equal((await ids(true)).includes(cancelled.id), false);
    const range = { start: new Date("2026-11-01"), end: new Date("2026-11-02") };
    assert.deepEqual(new Set((await db.task.findMany({ where: digestCrmTasksWhere(range, true) })).map((t) => t.id)), new Set([clientTask.id, oppTask.id]));
    assert.equal((await db.task.findMany({ where: digestCrmTasksWhere(range, false) })).length, 0);
    assert.ok((await db.task.findMany({ where: teamMemberOpenTasksWhere(f.pic.id, true) })).some((t) => t.id === oppTask.id));
    assert.deepEqual(await ids(false), [projectTask.id]);
    assert.equal((await db.task.findMany({ where: assignedByMeOpenWhere(f.manager.id, true) })).length, 2, "project membership still applies for delegated view");
    await db.project.update({ where: { id: project.id }, data: { status: "DONE" } });
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { outcome: "CS_DECLINED", closedAt: new Date() } });
    assert.deepEqual(await ids(true), [clientTask.id]);
    assert.deepEqual((await db.task.findMany({ where: digestCrmTasksWhere(range, true) })).map((t) => t.id), [clientTask.id]);
  } finally { try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); } }
});
