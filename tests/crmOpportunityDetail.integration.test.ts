import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadOpportunityDetail } from "../lib/crm/opportunityDetail";
import { openOpportunity, advanceStage } from "../lib/crm/opportunityWorkflow";
import { winOpportunity } from "../lib/crm/opportunityWin";
import { crmTestDatabaseUrl, createCrmTestDb, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";

test("detail isolates owners, orders next work/history and retains only transferred work after win", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(), prefix = `detail-${randomUUID()}`;
  const now = new Date("2026-11-09T10:00:00+07:00");
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id } });
    const actor = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
    const opened = await openOpportunity(db, actor, { clientId: f.client.id, name: `${prefix} Open`, programTypeCode: "MICE", expectedYear: 2026, expectedMonth: 11, source: "OTHER", demandSignal: "Need", picAccountId: f.picAccount.id, budgetMin: 1000000, budgetMax: 2000000 });
    assert.ok("ok" in opened); const id = opened.opportunityId;
    const effects = { notify: async () => {} };
    assert.ok("ok" in await advanceStage(db, actor, { opportunityId: id, expectedVersion: 0, to: "BRIEF", briefReceivedAt: now }, effects));
    assert.ok("ok" in await advanceStage(db, actor, { opportunityId: id, expectedVersion: 1, to: "BIDDING" }, effects));
    const createTask = (title: string, status: string, dueDate: Date | null) => db.task.create({ data: { opportunityId: id, creatorId: f.pic.id, assigneeId: f.assignee.id, title, status, dueDate, crmKind: "BID_PREP" } });
    const later = await createTask("Later", "TODO", new Date("2026-11-10T00:00:00+07:00"));
    const next = await createTask("Next", "IN_PROGRESS", new Date("2026-11-08T00:00:00+07:00"));
    await db.task.update({ where: { id: next.id }, data: { escalatedAt: now } });
    const done = await createTask("Done", "DONE", new Date("2026-11-01T00:00:00+07:00"));
    const cancelled = await createTask("Cancelled", "CANCELLED", new Date("2026-10-01T00:00:00+07:00"));
    await db.task.create({ data: { clientId: f.client.id, creatorId: f.pic.id, title: "Client only" } });
    await db.task.create({ data: { opportunityId: f.opportunity.id, creatorId: f.pic.id, title: "Other deal" } });
    const file = await db.projectFile.create({ data: { opportunityId: id, uploaderId: f.pic.id, name: "bid.txt", mimeType: "text/plain", size: 1, data: Buffer.from("x") } });
    await db.projectFile.create({ data: { opportunityId: f.opportunity.id, name: "other.txt", mimeType: "text/plain", size: 1 } });
    const meeting = await db.meeting.create({ data: { opportunityId: id, organizerId: f.pic.id, title: "Bid meeting", startAt: now, endAt: new Date(now.getTime() + 3600000) } });
    await db.meeting.create({ data: { clientId: f.client.id, organizerId: f.pic.id, title: "Client meeting", startAt: now, endAt: now } });
    await db.touchpoint.createMany({ data: [
      { opportunityId: id, clientId: f.client.id, authorId: f.pic.id, occurredAt: now, status: "DRAFT", kind: "CALL" },
      { opportunityId: id, clientId: f.client.id, authorId: f.pic.id, occurredAt: new Date("2026-11-01T00:00Z"), status: "CONFIRMED", kind: "MESSAGE", outcomeLevel: 2 },
      { opportunityId: id, clientId: f.client.id, occurredAt: now, status: "DISMISSED", kind: "CALL" },
      { clientId: f.client.id, occurredAt: now, status: "CONFIRMED", kind: "CALL", outcomeLevel: 1 },
    ] });
    const detail = await loadOpportunityDetail(db, id, now); assert.ok(detail);
    assert.deepEqual(detail.tasks.map(t => t.id), [next.id, later.id, cancelled.id, done.id]);
    assert.equal(detail.nextStep?.taskId, next.id); assert.equal(detail.nextStep?.overdue, true); assert.equal(detail.nextStep?.escalated, true);
    assert.equal(detail.openBidPrepTaskCount, 2); assert.equal(detail.budgetMin, 1000000); assert.equal(detail.budgetMax, 2000000); assert.equal(detail.timingLabel, "11/2026");
    assert.deepEqual(detail.files.map(f => f.id), [file.id]); assert.deepEqual(detail.meetings.map(m => m.id), [meeting.id]);
    assert.deepEqual(detail.touchpoints.map(t => t.status), ["DRAFT", "CONFIRMED"]);
    assert.equal(detail.touchpoints[0].authorName, f.pic.name);
    assert.deepEqual(detail.stageEvents.map(e => e.toStage), ["BIDDING", "BRIEF", "CARE"]);
    assert.equal(await loadOpportunityDetail(db, "missing", now), null);
    const won = await winOpportunity(db, actor, { opportunityId: id, expectedVersion: 2, contractValue: 1500000, wonAt: new Date("2026-11-08T00:00:00+07:00"), projectName: `${prefix} Project` });
    assert.ok("ok" in won);
    await db.task.create({ data: { projectId: won.projectId, creatorId: f.pic.id, title: "Project only" } });
    await db.projectFile.create({ data: { projectId: won.projectId, name: "Project only", mimeType: "text/plain", size: 0 } });
    const after = await loadOpportunityDetail(db, id, now); assert.ok(after);
    assert.equal(after.project?.id, won.projectId); assert.equal(after.contractValue, 1500000);
    assert.equal(after.tasks.length, 4); assert.ok(after.tasks.every(t => t.projectId === won.projectId && t.sourceOpportunityId === id));
    assert.deepEqual(after.files.map(f => f.id), [file.id]); assert.equal(after.meetings[0].projectId, won.projectId);
    assert.equal(after.stageEvents[0].outcome, "WON");
  } finally { await cleanupCrmFixture(db, prefix); await db.$disconnect(); }
});
