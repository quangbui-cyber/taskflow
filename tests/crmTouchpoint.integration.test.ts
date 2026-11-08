import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { dismissDraft, logTouchpoint, produceMeetingDrafts, validateTouchpointInput } from "../lib/crm/touchpoints";
import { publishRecap } from "../lib/recapWorkflow";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("touchpoint input requires an outcome and a complete next step or wait", () => {
  const input = { clientRequestId: randomUUID(), clientId: "client", kind: "CALL", occurredAt: new Date(), outcomeLevel: 2, next: { mode: "NEXT_STEP", title: "Call", assigneeId: "assignee", dueDate: new Date() } };
  const missingOutcome = validateTouchpointInput({ ...input, outcomeLevel: undefined });
  assert.ok("errors" in missingOutcome && missingOutcome.errors.outcomeLevel === "Chọn mức kết quả.");
  const missingStep = validateTouchpointInput({ ...input, next: null });
  assert.ok("errors" in missingStep && missingStep.errors.next === "Nhập việc cần làm và hạn, hoặc chọn Chờ khách.");
  const missingWait = validateTouchpointInput({ ...input, next: { mode: "WAIT", reason: "" } });
  assert.ok("errors" in missingWait && missingWait.errors.next === "Nhập lý do chờ và ngày xem lại.");
  assert.ok("errors" in validateTouchpointInput({ ...input, notes: "x".repeat(2001) }));
  assert.ok("errors" in validateTouchpointInput({ ...input, occurredAt: "not-a-date" }));
  assert.ok("ok" in validateTouchpointInput({ ...input, occurredAt: "2026-11-08", next: { ...input.next, dueDate: "2026-11-09" } }));
});

test("touchpoints are authorized, atomic, idempotent and draft-safe", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const prefix = randomUUID();
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const actor = (user: typeof f.pic) => ({ id: user.id, name: user.name, role: user.role, accountId: user.id === f.pic.id ? f.picAccount.id : null, managedTeamIds: [], isDataSteward: false });
    const pic = actor(f.pic);
    const input = () => ({ clientRequestId: randomUUID(), clientId: f.client.id, opportunityId: null, kind: "CALL", occurredAt: new Date("2026-11-08T03:00:00Z"), outcomeLevel: 2, notes: "Meaningful reply", next: { mode: "NEXT_STEP", title: "Follow up", assigneeId: f.assignee.id, dueDate: new Date("2026-11-10T17:00:00Z") } });

    await t.test("Client next step and assignment notification are committed together", async () => {
      const result = await logTouchpoint(db, pic, input());
      assert.ok("ok" in result);
      const row = await db.touchpoint.findUniqueOrThrow({ where: { id: result.touchpointId } });
      assert.equal(row.status, "CONFIRMED");
      assert.equal(row.authorId, f.pic.id);
      assert.equal(row.confirmedById, f.pic.id);
      const task = await db.task.findFirstOrThrow({ where: { creatorId: f.pic.id, clientId: f.client.id, title: "Follow up" } });
      assert.equal(task.crmKind, "NEXT_STEP");
      assert.equal(task.opportunityId, null);
      assert.equal(task.assigneeId, f.assignee.id);
      assert.equal(await db.notification.count({ where: { taskId: task.id, userId: f.assignee.id, type: "CRM_TASK_ASSIGNED", clientId: f.client.id } }), 1);
    });

    await t.test("Opportunity next steps stay with the Opportunity and appointment level is preserved", async () => {
      const result = await logTouchpoint(db, pic, { ...input(), opportunityId: f.opportunity.id, outcomeLevel: 3 });
      assert.ok("ok" in result);
      const row = await db.touchpoint.findUniqueOrThrow({ where: { id: result.touchpointId } });
      assert.equal(row.opportunityId, f.opportunity.id);
      const task = await db.task.findFirstOrThrow({ where: { opportunityId: f.opportunity.id, crmKind: "APPOINTMENT" } });
      assert.equal(task.clientId, null);
      assert.equal(task.projectId, null);
    });

    await t.test("confirmed need can open CARE and attach both touchpoint and next task", async () => {
      const result = await logTouchpoint(db, pic, { ...input(), outcomeLevel: 4, openOpportunity: { programTypeCode: "MICE", expectedYear: 2027, expectedMonth: 3, expectedQuarter: null, demandSignal: "Confirmed annual event" } });
      assert.ok("ok" in result && result.openedOpportunityId);
      const opportunity = await db.opportunity.findUniqueOrThrow({ where: { id: result.openedOpportunityId } });
      assert.equal(opportunity.stage, "CARE");
      assert.equal(await db.opportunityStageEvent.count({ where: { opportunityId: opportunity.id, toStage: "CARE" } }), 1);
      assert.equal((await db.touchpoint.findUniqueOrThrow({ where: { id: result.touchpointId } })).opportunityId, opportunity.id);
      assert.equal(await db.task.count({ where: { opportunityId: opportunity.id, crmKind: "NEXT_STEP" } }), 1);
    });

    await t.test("repeat and concurrent submission create only one touchpoint and one task", async () => {
      const payload = input();
      const before = await db.task.count({ where: { creatorId: f.pic.id } });
      const results = await Promise.all([logTouchpoint(db, pic, payload), logTouchpoint(db, pic, payload)]);
      assert.ok("ok" in results[0] && "ok" in results[1]);
      assert.equal(results[0].touchpointId, results[1].touchpointId);
      assert.equal(await db.touchpoint.count({ where: { clientRequestId: payload.clientRequestId } }), 1);
      assert.equal(await db.task.count({ where: { creatorId: f.pic.id } }), before + 1);
      const outsider = await logTouchpoint(db, actor(f.outsider), payload);
      assert.ok("error" in outsider);
    });

    await t.test("own task assignee can log and complete only the matching owner task", async () => {
      const task = await db.task.create({ data: { title: "Owned care task", creatorId: f.pic.id, assigneeId: f.assignee.id, clientId: f.client.id } });
      assert.ok("error" in await logTouchpoint(db, actor(f.outsider), { ...input(), completeTaskId: task.id }));
      const result = await logTouchpoint(db, actor(f.assignee), { ...input(), completeTaskId: task.id });
      assert.ok("ok" in result);
      const stored = await db.task.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(stored.status, "DONE");
      assert.ok(stored.completedAt);
      const foreign = await db.client.create({ data: { name: `${prefix} Foreign client` } });
      assert.ok("error" in await logTouchpoint(db, actor(f.assignee), { ...input(), clientId: foreign.id, completeTaskId: task.id }));
    });

    await t.test("WAIT creates a dated Client task and invalid targets do not partially save", async () => {
      const result = await logTouchpoint(db, pic, { ...input(), next: { mode: "WAIT", reason: "Client reviews plan", reviewDate: new Date("2026-11-20") } });
      assert.ok("ok" in result);
      const task = await db.task.findFirstOrThrow({ where: { clientId: f.client.id, crmKind: "WAIT" } });
      assert.equal(task.title, "Chờ khách: Client reviews plan");
      assert.ok(task.dueDate);
      const bad = { ...input(), next: { ...input().next, assigneeId: "missing-user" } };
      assert.ok("error" in await logTouchpoint(db, pic, bad));
      assert.equal(await db.touchpoint.count({ where: { clientRequestId: bad.clientRequestId } }), 0);
      assert.ok("error" in await logTouchpoint(db, pic, { ...input(), opportunityId: "missing-opportunity" }));
    });

    await t.test("meeting drafts contain metadata only and are never recreated after dismissal", async () => {
      const meeting = await db.meeting.create({ data: { title: "Private client meeting", organizerId: f.pic.id, clientId: f.client.id, startAt: new Date("2026-11-07T03:00:00Z"), endAt: new Date("2026-11-07T04:00:00Z") } });
      await db.meetingRecap.create({ data: { meetingId: meeting.id, status: "READY", content: "PRIVATE RECAP CONTENT" } });
      await Promise.all([produceMeetingDrafts(db, meeting.id, "RECAP"), produceMeetingDrafts(db, meeting.id, "RECAP")]);
      assert.equal(await db.touchpoint.count({ where: { sourceId: meeting.id } }), 1);
      const draft = await db.touchpoint.findFirstOrThrow({ where: { sourceId: meeting.id } });
      assert.equal(draft.status, "DRAFT");
      assert.equal(draft.notes, null);
      assert.equal(draft.outcomeLevel, null);
      assert.equal(draft.occurredAt.toISOString(), meeting.startAt.toISOString());
      assert.equal(await db.notification.count({ where: { userId: f.pic.id, meetingId: meeting.id, type: "CRM_DRAFT" } }), 1);
      assert.ok("error" in await dismissDraft(db, actor(f.outsider), draft.id));
      assert.ok("ok" in await dismissDraft(db, pic, draft.id));
      await produceMeetingDrafts(db, meeting.id, "RECAP");
      assert.equal((await db.touchpoint.findUniqueOrThrow({ where: { id: draft.id } })).status, "DISMISSED");
      assert.equal(await db.touchpoint.count({ where: { sourceId: meeting.id } }), 1);
    });

    await t.test("draft confirmation updates the draft once, without accepting a foreign draft", async () => {
      const meeting = await db.meeting.create({ data: { title: "Opportunity meeting", organizerId: f.pic.id, opportunityId: f.opportunity.id, startAt: new Date(), endAt: new Date(Date.now() + 3_600_000) } });
      await produceMeetingDrafts(db, meeting.id, "MEETING");
      const draft = await db.touchpoint.findFirstOrThrow({ where: { sourceId: meeting.id } });
      const payload = { ...input(), opportunityId: f.opportunity.id, confirmDraftId: draft.id };
      const result = await logTouchpoint(db, pic, payload);
      assert.ok("ok" in result && result.touchpointId === draft.id);
      assert.ok("ok" in await logTouchpoint(db, pic, payload));
      assert.ok("error" in await logTouchpoint(db, pic, { ...payload, clientRequestId: randomUUID() }));
      const row = await db.touchpoint.findUniqueOrThrow({ where: { id: draft.id } });
      assert.equal(row.status, "CONFIRMED");
      assert.equal(row.confirmedById, f.pic.id);
    });

    await t.test("published recaps create one draft only when CRM is enabled", async () => {
      const old = process.env.CRM_ENABLED;
      try {
        process.env.CRM_ENABLED = "true";
        const meeting = await db.meeting.create({ data: { title: "Published meeting", organizerId: f.pic.id, clientId: f.client.id, startAt: new Date(), endAt: new Date(Date.now() + 3_600_000) } });
        const recap = await db.meetingRecap.create({ data: { meetingId: meeting.id, status: "READY", content: "PRIVATE PUBLISHED CONTENT" } });
        await publishRecap(db, recap.id, new Date());
        await publishRecap(db, recap.id, new Date());
        assert.equal(await db.touchpoint.count({ where: { sourceId: meeting.id, status: "DRAFT" } }), 1);
        process.env.CRM_ENABLED = "false";
        const off = await db.meeting.create({ data: { title: "Flag off", organizerId: f.pic.id, clientId: f.client.id, startAt: new Date(), endAt: new Date(Date.now() + 3_600_000) } });
        const offRecap = await db.meetingRecap.create({ data: { meetingId: off.id, status: "READY", content: "Reviewed" } });
        assert.ok(await publishRecap(db, offRecap.id, new Date()));
        assert.equal(await db.touchpoint.count({ where: { sourceId: off.id } }), 0);
      } finally { if (old === undefined) delete process.env.CRM_ENABLED; else process.env.CRM_ENABLED = old; }
    });
  } finally {
    try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); }
  }
});
