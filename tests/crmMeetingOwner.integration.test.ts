import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { attachMeetingOwner, archivePublishedRecap } from "../lib/recapProject";
import { createLinkedRecapTask, publishRecap } from "../lib/recapWorkflow";
import { createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";
test("meetings attach atomically to one owner and create recap tasks in that owner", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = randomUUID();
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const meeting = await db.meeting.create({ data: { title: "CRM meeting", organizerId: f.pic.id, startAt: new Date("2026-01-01"), endAt: new Date("2026-01-01T01:00:00Z") } });
    const opportunity = { kind: "OPPORTUNITY" as const, id: f.opportunity.id };
    const client = { kind: "CLIENT" as const, id: f.client.id };
    assert.ok("error" in await attachMeetingOwner(db, meeting.id, opportunity, f.outsider));
    assert.equal((await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).opportunityId, null);
    assert.ok("owner" in await attachMeetingOwner(db, meeting.id, opportunity, f.pic));
    const second = await attachMeetingOwner(db, meeting.id, client, f.pic);
    assert.ok("error" in second && typeof second.error === "string" && second.error.includes("đã được gắn"));
    const recap = await db.meetingRecap.create({ data: { meetingId: meeting.id, status: "READY", content: "Reviewed" } });
    const item = await db.meetingRecapActionItem.create({ data: { recapId: recap.id, title: "Follow up", ownerId: f.assignee.id } });
    const task = await createLinkedRecapTask(db, recap.id, item.id, opportunity, f.pic.id, "From recap");
    const stored = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(stored.opportunityId, f.opportunity.id); assert.equal(stored.projectId, null);
    const snapshot = await publishRecap(db, recap.id, new Date());
    assert.ok(snapshot);
    assert.equal(snapshot?.actionItems[0].task?.ownerName, f.opportunity.name);
    assert.equal(await archivePublishedRecap(db, meeting.id, f.pic), true);
    const archived = await db.projectFile.findFirstOrThrow({ where: { opportunityId: f.opportunity.id } });
    assert.equal(archived.projectId, null);
    const race = await db.meeting.create({ data: { title: "Concurrent attach", organizerId: f.pic.id, startAt: new Date("2026-01-01"), endAt: new Date("2026-01-01T01:00:00Z") } });
    const outcomes = await Promise.all([attachMeetingOwner(db, race.id, opportunity, f.pic), attachMeetingOwner(db, race.id, client, f.pic)]);
    assert.equal(outcomes.filter((o) => "owner" in o).length, 1);
    const row = await db.meeting.findUniqueOrThrow({ where: { id: race.id } });
    assert.equal([row.projectId, row.clientId, row.opportunityId].filter(Boolean).length, 1);
  } finally { try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); } }
});
