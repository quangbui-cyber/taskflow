import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("CRM owner constraints protect tasks, files, meetings and confirmed touchpoints", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb();
  const prefix = `crm-owner-${randomUUID()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    assert.ok(f.opportunity.id);
    const project = await db.project.create({ data: { name: `${prefix} Project`, ownerId: f.admin.id, clientId: f.client.id } });
    const task = { title: `${prefix} Task`, creatorId: f.admin.id };
    await db.task.create({ data: { ...task, projectId: project.id } });
    await db.task.create({ data: { ...task, opportunityId: f.opportunity.id } });
    await db.task.create({ data: { ...task, clientId: f.client.id } });
    await assert.rejects(db.task.create({ data: task }), /check constraint/i);
    await assert.rejects(db.task.create({ data: { ...task, projectId: project.id, clientId: f.client.id } }), /check constraint/i);
    const file = { name: `${prefix} File`, mimeType: "text/plain", size: 0 };
    await db.projectFile.create({ data: { ...file, projectId: project.id } });
    await db.projectFile.create({ data: { ...file, opportunityId: f.opportunity.id } });
    await db.projectFile.create({ data: { ...file, clientId: f.client.id } });
    await assert.rejects(db.projectFile.create({ data: file }), /check constraint/i);
    await assert.rejects(db.projectFile.create({ data: { ...file, projectId: project.id, clientId: f.client.id } }), /check constraint/i);
    const meeting = { title: `${prefix} Meeting`, organizerId: f.admin.id, startAt: new Date("2026-11-10T03:00:00Z"), endAt: new Date("2026-11-10T04:00:00Z") };
    await db.meeting.create({ data: meeting });
    await assert.rejects(db.meeting.create({ data: { ...meeting, opportunityId: f.opportunity.id, clientId: f.client.id } }), /check constraint/i);
    await assert.rejects(db.touchpoint.create({ data: { clientId: f.client.id, kind: "CALL", occurredAt: new Date() } }), /check constraint/i);
    await db.touchpoint.create({ data: { clientId: f.client.id, kind: "CALL", occurredAt: new Date(), outcomeLevel: 2 } });
    await assert.rejects(db.touchpoint.create({ data: { clientId: f.client.id, kind: "CALL", occurredAt: new Date(), outcomeLevel: 5 } }), /check constraint/i);
    await assert.rejects(db.expectedEvent.create({ data: { clientId: f.client.id, programTypeCode: "MICE", precision: "MONTH", year: 2026, source: "HISTORY" } }), /check constraint/i);
  } finally {
    await cleanupCrmFixture(db, prefix);
    await db.$disconnect();
  }
});
