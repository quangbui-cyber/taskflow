import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { winOpportunity, winPreview } from "../lib/crm/opportunityWin";
import { crmTestDatabaseUrl, createCrmTestDb, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";

test("win is atomic, preserves work and membership, and recognizes only the contract on the VN win day", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb();
  const prefix = `win-${randomUUID()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    const actor = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
    const input = { opportunityId: f.opportunity.id, expectedVersion: 0, contractValue: 1_200_000_000, wonAt: new Date("2026-10-15T08:00:00+07:00"), projectName: `${prefix} Project` };
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { budgetMin: 5_000_000_000, budgetMax: 6_000_000_000, opportunityMembers: { create: [{ userId: f.manager.id }, { userId: f.pic.id }] } } });
    const task = await db.task.create({ data: { title: `${prefix} Work`, creatorId: f.admin.id, assigneeId: f.assignee.id, opportunityId: f.opportunity.id, followers: { create: { userId: f.outsider.id } } } });
    const otherTask = await db.task.create({ data: { title: `${prefix} Other work`, creatorId: f.pic.id, opportunityId: f.opportunity.id } });
    const clientTask = await db.task.create({ data: { title: `${prefix} Client work`, creatorId: f.pic.id, clientId: f.client.id } });
    const file = await db.projectFile.create({ data: { name: `${prefix}.txt`, mimeType: "text/plain", size: 1, data: Buffer.from("x"), opportunityId: f.opportunity.id, uploaderId: f.pic.id } });
    const meeting = await db.meeting.create({ data: { title: `${prefix} Meeting`, organizerId: f.pic.id, opportunityId: f.opportunity.id, startAt: new Date("2026-10-14T01:00:00Z"), endAt: new Date("2026-10-14T02:00:00Z") } });
    const event = await db.expectedEvent.create({ data: { clientId: f.client.id, programTypeCode: "MICE", precision: "MONTH", year: 2026, month: 10, source: "OTHER", opportunity: { connect: { id: f.opportunity.id } }, expectedEventSteps: { create: [{ revision: 0, kind: "BRIEF", dueDate: input.wonAt, status: "OPEN" }, { revision: 0, kind: "CARE", dueDate: input.wonAt, status: "PLANNED" }] } } });
    const preview = await winPreview(db, f.opportunity.id);
    assert.equal(preview.tasks, 2); assert.equal(preview.files, 1); assert.equal(preview.meetings, 1);
    assert.equal(Number(preview.budgetMin), 5_000_000_000); assert.equal(Number(preview.budgetMax), 6_000_000_000);
    const [a, b] = await Promise.all([winOpportunity(db, actor, input), winOpportunity(db, actor, input)]);
    assert.ok("ok" in a); assert.ok("ok" in b);
    assert.equal(a.projectId, b.projectId);
    assert.deepEqual([a.alreadyWon, b.alreadyWon].sort(), [false, true]);
    assert.equal(await db.project.count({ where: { sourceOpportunityId: f.opportunity.id } }), 1);
    const project = await db.project.findUniqueOrThrow({ where: { id: a.projectId }, include: { members: true } });
    assert.equal(project.status, "ON_PROCESS"); assert.equal(project.category, "CLIENT"); assert.equal(project.type, "MICE");
    assert.equal(project.revenue, input.contractValue); assert.equal(project.clientId, f.client.id); assert.equal(project.accountId, f.picAccount.id); assert.equal(project.responsibleTeamId, null);
    assert.equal(project.onProcessAt?.toISOString(), "2026-10-14T17:00:00.000Z");
    assert.deepEqual(project.members.map((m) => m.userId).sort(), [f.pic.id, f.manager.id, f.admin.id, f.assignee.id, f.outsider.id].sort());
    assert.equal(project.members.find((m) => m.userId === actor.id)?.role, "owner");
    for (const moved of [await db.task.findUniqueOrThrow({ where: { id: task.id } }), await db.task.findUniqueOrThrow({ where: { id: otherTask.id } }), await db.projectFile.findUniqueOrThrow({ where: { id: file.id } }), await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } })]) {
      assert.equal(moved.projectId, project.id); assert.equal(moved.sourceOpportunityId, f.opportunity.id); assert.equal(moved.opportunityId, null);
    }
    const untouched = await db.task.findUniqueOrThrow({ where: { id: clientTask.id } });
    assert.equal(untouched.clientId, f.client.id); assert.equal(untouched.projectId, null); assert.equal(untouched.sourceOpportunityId, null);
    const closed = await db.opportunity.findUniqueOrThrow({ where: { id: f.opportunity.id } });
    assert.equal(closed.outcome, "WON"); assert.equal(closed.version, 1); assert.equal(Number(closed.contractValue), input.contractValue); assert.equal(closed.closedById, actor.id);
    const stages = await db.opportunityStageEvent.findMany({ where: { opportunityId: f.opportunity.id }, orderBy: { occurredAt: "asc" } });
    assert.equal(stages.length, 1); assert.equal(stages[0].fromStage, "BIDDING"); assert.equal(stages[0].toStage, "WON"); assert.equal(stages[0].outcome, "WON"); assert.equal(stages[0].actorName, actor.name);
    const steps = await db.reminderStep.findMany({ where: { expectedEventId: event.id } });
    assert.equal(steps.length, 2); assert.ok(steps.every((step) => step.status === "CLOSED" && step.closedReason === "OPPORTUNITY_WON"));
    const again = await winOpportunity(db, actor, input);
    assert.ok("ok" in again); assert.equal(again.projectId, project.id); assert.equal(again.alreadyWon, true);
  } finally { await cleanupCrmFixture(db, prefix); await db.$disconnect(); }
});

test("win rejects invalid amounts, stages, dates, versions, names and unauthorized actors without mutation", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = `win-invalid-${randomUUID()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    const actor = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
    const input = { opportunityId: f.opportunity.id, expectedVersion: 0, contractValue: 100, wonAt: new Date("2026-10-15T00:00:00+07:00"), projectName: `${prefix} Project` };
    for (const contractValue of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.deepEqual(await winOpportunity(db, actor, { ...input, contractValue }), { error: "Nhập giá trị hợp đồng." });
    assert.ok("error" in await winOpportunity(db, actor, { ...input, wonAt: new Date("2200-01-01") }));
    assert.ok("error" in await winOpportunity(db, actor, { ...input, wonAt: new Date(NaN) }));
    assert.ok("error" in await winOpportunity(db, actor, { ...input, projectName: " ".repeat(2) }));
    assert.ok("error" in await winOpportunity(db, actor, { ...input, projectName: "x".repeat(201) }));
    assert.ok("error" in await winOpportunity(db, actor, { ...input, expectedVersion: 10 }));
    const outsider = { ...actor, id: f.outsider.id, name: f.outsider.name, role: f.outsider.role, accountId: null };
    assert.ok("error" in await winOpportunity(db, outsider, input));
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { stage: "BRIEF" } });
    assert.deepEqual(await winOpportunity(db, actor, input), { error: "Thắng chỉ ghi được từ Bidding." });
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { stage: "BIDDING", outcome: "CUSTOMER_CANCELLED" } });
    assert.deepEqual(await winOpportunity(db, actor, input), { error: "Cơ hội đã kết thúc không mở lại được." });
    assert.equal(await db.project.count({ where: { sourceOpportunityId: f.opportunity.id } }), 0);
    assert.equal(await db.opportunityStageEvent.count({ where: { opportunityId: f.opportunity.id } }), 0);
  } finally { await cleanupCrmFixture(db, prefix); await db.$disconnect(); }
});
