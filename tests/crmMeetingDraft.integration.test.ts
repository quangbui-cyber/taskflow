import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadMeetingDraftForViewer } from "../lib/crm/meetingDrafts";
import { dismissDraft, logTouchpoint, produceMeetingDrafts } from "../lib/crm/touchpoints";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("recap draft exposes only metadata to readers and disappears after confirmation or dismissal", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb();
  const prefix = `meeting-draft-${randomUUID()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.otherAccount.id } });
    const actor = (user: typeof f.pic) => ({
      id: user.id, name: user.name, role: user.role, managedTeamIds: [], isDataSteward: false,
      accountId: user.id === f.pic.id ? f.picAccount.id : user.id === f.manager.id ? f.otherAccount.id : null,
    });
    const clientPic = actor(f.manager);
    const opportunityPic = actor(f.pic);
    const reader = actor(f.outsider);
    const startAt = new Date("2026-11-07T17:15:00Z");
    const endAt = new Date("2026-11-07T18:15:00Z");
    const createMeeting = async (sourceType: "RECAP" | "MEETING", opportunityId?: string) => {
      const meeting = await db.meeting.create({ data: {
        title: `${prefix} Meeting`, organizerId: f.manager.id, startAt, endAt,
        ...(opportunityId ? { opportunityId } : { clientId: f.client.id }),
      } });
      await db.meetingRecap.create({ data: { meetingId: meeting.id, status: "READY", content: "PRIVATE RECAP CONTENT" } });
      assert.deepEqual(await produceMeetingDrafts(db, meeting.id, sourceType), { created: 1 });
      return meeting;
    };
    const view = (meeting: Awaited<ReturnType<typeof createMeeting>>, who: ReturnType<typeof actor>, canSee = true) =>
      loadMeetingDraftForViewer(db, { meetingId: meeting.id, meetingTitle: meeting.title, canSee, actor: who });

    const clientMeeting = await createMeeting("RECAP");
    assert.equal(await view(clientMeeting, clientPic, false), null);
    const clientDraft = await view(clientMeeting, clientPic);
    assert.ok(clientDraft);
    assert.deepEqual(clientDraft, {
      draftId: clientDraft.draftId,
      clientId: f.client.id, clientName: f.client.name, opportunityId: null, opportunityName: null,
      occurredAt: startAt.toISOString(), meetingTitle: clientMeeting.title, canConfirm: true,
    });
    assert.deepEqual(await view(clientMeeting, reader), { ...clientDraft, canConfirm: false });
    assert.ok("ok" in await dismissDraft(db, clientPic, clientDraft.draftId));
    assert.equal(await view(clientMeeting, clientPic), null);

    const opportunityMeeting = await createMeeting("MEETING", f.opportunity.id);
    const opportunityDraft = await view(opportunityMeeting, opportunityPic);
    assert.ok(opportunityDraft);
    assert.deepEqual(opportunityDraft, {
      draftId: opportunityDraft.draftId,
      clientId: f.client.id, clientName: f.client.name, opportunityId: f.opportunity.id, opportunityName: f.opportunity.name,
      occurredAt: startAt.toISOString(), meetingTitle: opportunityMeeting.title, canConfirm: true,
    });
    assert.deepEqual(await view(opportunityMeeting, clientPic), { ...opportunityDraft, canConfirm: false });
    assert.ok("error" in await dismissDraft(db, opportunityPic, opportunityDraft.draftId));
    const result = await logTouchpoint(db, opportunityPic, {
      clientRequestId: randomUUID(), clientId: f.client.id, opportunityId: f.opportunity.id,
      kind: "MEETING", occurredAt: startAt, outcomeLevel: 2, confirmDraftId: opportunityDraft.draftId,
      next: { mode: "WAIT", reason: "Synthetic follow-up", reviewDate: new Date("2026-11-11T17:00:00Z") },
    });
    assert.ok("ok" in result && result.touchpointId === opportunityDraft.draftId);
    assert.equal(await view(opportunityMeeting, opportunityPic), null);
    assert.equal(await db.touchpoint.count({ where: { sourceId: opportunityMeeting.id, status: "CONFIRMED" } }), 1);

    const closedMeeting = await createMeeting("RECAP", f.opportunity.id);
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { outcome: "CUSTOMER_CANCELLED" } });
    const closedDraft = await view(closedMeeting, clientPic);
    assert.equal(closedDraft?.opportunityName, f.opportunity.name);
    assert.equal(closedDraft?.canConfirm, false);
    assert.ok("ok" in await dismissDraft(db, clientPic, closedDraft!.draftId));
    assert.equal(await view(closedMeeting, clientPic), null);
  } finally {
    try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); }
  }
});
