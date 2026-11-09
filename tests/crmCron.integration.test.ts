import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { runCrmReminderJob } from "../lib/crm/reminderJob";
import { createExpectedEvent } from "../lib/crm/eventService";
import { cadencePeriodKey } from "../lib/crm/cadence";
import { addDaysVn, vnDayStart, vnDateKey } from "../lib/crm/dates";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("daily CRM job opens, merges and deduplicates reminder work", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const now = new Date("2026-11-10T09:00:00+07:00");
  const today = vnDayStart(now);
  const previous = await db.crmSetting.findUnique({ where: { key: "tier.cadenceWeeks" } });
  try {
    await db.crmSetting.upsert({ where: { key: "tier.cadenceWeeks" }, create: { key: "tier.cadenceWeeks", value: { S: 2, A: 4, B: 8, C: 13, UNRATED: 4 } }, update: { value: { S: 2, A: 4, B: 8, C: 13, UNRATED: 4 } } });
    const scenario = async (name: string, run: (f: Awaited<ReturnType<typeof seedCrmFixture>>, prefix: string) => Promise<void>) => t.test(name, async () => {
      const prefix = `cron-${randomUUID()}`;
      try {
        const f = await seedCrmFixture(db, prefix);
        await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id, createdAt: today } });
        await run(f, prefix);
      } finally { await cleanupCrmFixture(db, prefix); }
    });
    type Fixture = Awaited<ReturnType<typeof seedCrmFixture>>;
    const event = (f: Fixture, dueDate = today, date = addDaysVn(today, 90)) => db.expectedEvent.create({ data: {
      clientId: f.client.id, createdById: f.pic.id, programTypeCode: "MICE", precision: "DAY", year: 2027, date, source: "HISTORY",
      expectedEventSteps: { create: { kind: "OFFSET", offsetDays: 90, revision: 0, dueDate } },
    }, include: { expectedEventSteps: true } });
    const task = (f: Fixture, extra: Partial<Prisma.TaskUncheckedCreateInput> = {}) => db.task.create({ data: { title: "Existing work", creatorId: f.pic.id, assigneeId: f.pic.id, clientId: f.client.id, dueDate: today, crmKind: "NEXT_STEP", ...extra } });
    const confirmed = (f: Fixture, days: number) => db.touchpoint.create({ data: { clientId: f.client.id, kind: "CALL", status: "CONFIRMED", occurredAt: addDaysVn(today, -days), confirmedAt: addDaysVn(today, -days) } });

    await scenario("1 planned step in this week opens a PIC-assigned Client reminder", async f => {
      const e = await event(f);
      const s = await runCrmReminderJob(db, { now });
      const step = await db.reminderStep.findUniqueOrThrow({ where: { id: e.expectedEventSteps[0].id }, include: { task: true } });
      assert.equal(step.status, "OPEN"); assert.ok(step.task);
      assert.equal(step.task.clientId, f.client.id); assert.equal(step.task.opportunityId, null); assert.equal(step.task.crmKind, "EVENT_REMINDER");
      assert.equal(step.task.assigneeId, f.pic.id); assert.equal(step.task.status, "TODO"); assert.equal(step.task.dueDate?.getTime(), today.getTime()); assert.ok(s.openedSteps >= 1);
    });
    await scenario("2 event linked to an open Opportunity keeps exclusive Opportunity ownership", async f => {
      const e = await event(f);
      await db.opportunity.update({ where: { id: f.opportunity.id }, data: { expectedEventId: e.id } });
      await runCrmReminderJob(db, { now });
      const step = await db.reminderStep.findUniqueOrThrow({ where: { id: e.expectedEventSteps[0].id }, include: { task: true } });
      assert.equal(step.task?.opportunityId, f.opportunity.id); assert.equal(step.task?.clientId, null); assert.equal(step.task?.projectId, null);
    });
    await scenario("3 steps three months away remain planned", async f => {
      const e = await event(f, addDaysVn(today, 90), addDaysVn(today, 180));
      await runCrmReminderJob(db, { now });
      const step = await db.reminderStep.findUniqueOrThrow({ where: { id: e.expectedEventSteps[0].id } });
      assert.equal(step.status, "PLANNED"); assert.equal(step.taskId, null);
    });
    await scenario("4 matching Opportunity next step is consolidated with the earlier due date", async f => {
      const e = await event(f);
      await db.opportunity.update({ where: { id: f.opportunity.id }, data: { expectedEventId: e.id } });
      const existing = await task(f, { clientId: null, opportunityId: f.opportunity.id, dueDate: addDaysVn(today, 5) });
      const s = await runCrmReminderJob(db, { now });
      assert.equal((await db.reminderStep.findUniqueOrThrow({ where: { id: e.expectedEventSteps[0].id } })).taskId, existing.id);
      assert.equal(await db.task.count({ where: { opportunityId: f.opportunity.id } }), 1);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: existing.id } })).dueDate?.getTime(), today.getTime()); assert.ok(s.mergedSteps >= 1);
    });
    await scenario("5 UNRATED cadence uses confirmed contact, never yesterday's draft", async f => {
      await confirmed(f, 35);
      await db.touchpoint.create({ data: { clientId: f.client.id, kind: "CALL", status: "DRAFT", occurredAt: addDaysVn(today, -1) } });
      await runCrmReminderJob(db, { now });
      assert.equal(await db.task.count({ where: { clientId: f.client.id, crmKind: "CADENCE" } }), 1);
      assert.equal(await db.cadenceReminder.count({ where: { clientId: f.client.id, periodKey: cadencePeriodKey(addDaysVn(today, -7)) } }), 1);
    });
    await scenario("6 open reach work or a recent confirmed contact suppresses cadence", async f => {
      await confirmed(f, 35); const existing = await task(f);
      await runCrmReminderJob(db, { now });
      assert.equal(await db.task.count({ where: { clientId: f.client.id, crmKind: "CADENCE" } }), 0);
      await db.task.delete({ where: { id: existing.id } }); await confirmed(f, 14);
      await runCrmReminderJob(db, { now });
      assert.equal(await db.task.count({ where: { clientId: f.client.id, crmKind: "CADENCE" } }), 0);
    });
    await scenario("7 plan-close in 28 days takes precedence over cadence", async f => {
      await confirmed(f, 35); await db.client.update({ where: { id: f.client.id }, data: { budgetSeasonMonth: 12 } });
      await runCrmReminderJob(db, { now });
      assert.equal(await db.task.count({ where: { clientId: f.client.id, crmKind: "PLAN_CLOSE" } }), 1);
      assert.equal(await db.task.count({ where: { clientId: f.client.id, crmKind: "CADENCE" } }), 0);
      assert.equal(await db.cadenceReminder.count({ where: { clientId: f.client.id, periodKey: "plan-close:2026" } }), 1);
    });
    await scenario("8 repeated execution changes no work, periods or inserted notice keys", async f => {
      await event(f);
      const first = await runCrmReminderJob(db, { now });
      const rows = first.notifications.filter(n => n.clientId === f.client.id || n.opportunityId === f.opportunity.id);
      await db.notification.createMany({ data: rows, skipDuplicates: true });
      const before = await db.reminderStep.findMany({ where: { expectedEvent: { clientId: f.client.id } } });
      const tasks = await db.task.count({ where: { creatorId: f.pic.id } });
      const periods = await db.cadenceReminder.count({ where: { clientId: f.client.id } });
      const second = await runCrmReminderJob(db, { now });
      const again = second.notifications.filter(n => n.clientId === f.client.id || n.opportunityId === f.opportunity.id);
      assert.deepEqual(new Set(again.map(n => n.dedupeKey)), new Set(rows.map(n => n.dedupeKey)));
      await db.notification.createMany({ data: again, skipDuplicates: true });
      assert.equal(await db.notification.count({ where: { dedupeKey: { in: rows.map(n => n.dedupeKey) } } }), rows.length);
      assert.deepEqual(await db.reminderStep.findMany({ where: { expectedEvent: { clientId: f.client.id } } }), before);
      assert.equal(await db.task.count({ where: { creatorId: f.pic.id } }), tasks); assert.equal(await db.cadenceReminder.count({ where: { clientId: f.client.id } }), periods);
    });
    await scenario("9 concurrent jobs and event save create each step and period only once", async f => {
      const e = await event(f); await confirmed(f, 35);
      await db.client.update({ where: { id: f.client.id }, data: { budgetSeasonMonth: 12 } });
      const actor = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
      const results = await Promise.all([runCrmReminderJob(db, { now }), runCrmReminderJob(db, { now }), createExpectedEvent(db, actor, { clientId: f.client.id, programTypeCode: "MICE", precision: "DAY", year: 2027, date: "2027-02-08", source: "HISTORY" })]);
      assert.ok("ok" in results[2]); await runCrmReminderJob(db, { now });
      const steps = await db.reminderStep.findMany({ where: { expectedEvent: { clientId: f.client.id }, status: "OPEN" } });
      assert.ok(steps.some(s => s.expectedEventId === e.id)); assert.ok(steps.every(s => s.taskId));
      assert.equal(await db.task.count({ where: { clientId: f.client.id, crmKind: "EVENT_REMINDER" } }), 1);
      assert.equal(await db.cadenceReminder.count({ where: { clientId: f.client.id, periodKey: "plan-close:2026" } }), 1);
    });
    await scenario("10 only active reach assignees receive due and scheduled overdue notices", async f => {
      const due = await task(f, { crmKind: "EVENT_REMINDER" });
      const late = await task(f, { dueDate: addDaysVn(today, -3) });
      const muted = await task(f, { dueDate: addDaysVn(today, -2) });
      const ordinary = await task(f, { crmKind: null });
      await db.user.update({ where: { id: f.outsider.id }, data: { isActive: false } });
      const inactive = await task(f, { assigneeId: f.outsider.id });
      const s = await runCrmReminderJob(db, { now });
      assert.ok(s.notifications.some(n => n.taskId === due.id && n.type === "CRM_DUE" && n.message === `Đến hạn tiếp cận ${f.client.name}: Mốc trước sự kiện.` && n.clientId === f.client.id && n.dedupeKey === `crm:${due.id}:${vnDateKey(now)}:${f.pic.id}`));
      assert.ok(s.notifications.some(n => n.taskId === late.id && n.type === "CRM_OVERDUE" && n.message === `${f.client.name} quá hạn tiếp cận 3 ngày.`));
      assert.ok(!s.notifications.some(n => [muted.id, ordinary.id, inactive.id].includes(n.taskId ?? "")));
    });
    await scenario("11 weekly quality nudges go to PIC or active stewards with a Client link", async f => {
      await db.touchpoint.create({ data: { clientId: f.client.id, kind: "CALL", status: "DRAFT", occurredAt: addDaysVn(today, -8), createdAt: addDaysVn(today, -8) } });
      const s = await runCrmReminderJob(db, { now });
      const notices = s.notifications.filter(n => n.clientId === f.client.id && n.dedupeKey.includes(":nudge:"));
      assert.equal(notices.length, 2); assert.ok(notices.every(n => n.userId === f.pic.id && n.opportunityId === null && n.taskId === null));
      await db.client.update({ where: { id: f.client.id }, data: { picAccountId: null } });
      await db.user.update({ where: { id: f.assignee.id }, data: { isCrmDataSteward: true } });
      await db.user.update({ where: { id: f.outsider.id }, data: { isCrmDataSteward: true, isActive: false } });
      const next = await runCrmReminderJob(db, { now });
      const fallback = next.notifications.filter(n => n.clientId === f.client.id && n.dedupeKey.includes(":nudge:"));
      assert.ok(fallback.some(n => n.userId === f.assignee.id)); assert.ok(!fallback.some(n => n.userId === f.outsider.id || n.userId === f.pic.id));
    });
    await scenario("12 passed event supersedes only PLANNED steps and preserves OPEN task", async f => {
      const e = await event(f, addDaysVn(today, -8), addDaysVn(today, -1));
      const existing = await task(f, { crmKind: "EVENT_REMINDER" });
      const open = await db.reminderStep.create({ data: { expectedEventId: e.id, kind: "OFFSET", offsetDays: 30, revision: 0, dueDate: today, status: "OPEN", taskId: existing.id } });
      await runCrmReminderJob(db, { now });
      assert.equal((await db.expectedEvent.findUniqueOrThrow({ where: { id: e.id } })).status, "PASSED");
      assert.equal((await db.reminderStep.findUniqueOrThrow({ where: { id: e.expectedEventSteps[0].id } })).status, "SUPERSEDED");
      assert.equal((await db.reminderStep.findUniqueOrThrow({ where: { id: open.id } })).status, "OPEN"); assert.equal((await db.task.findUniqueOrThrow({ where: { id: existing.id } })).status, "TODO");
    });
    await scenario("13 ended meeting without recap produces one metadata-only draft on repeat", async f => {
      const m = await db.meeting.create({ data: { title: "Client meeting", organizerId: f.pic.id, clientId: f.client.id, startAt: new Date(now.getTime() - 7200000), endAt: new Date(now.getTime() - 3600000) } });
      const s = await runCrmReminderJob(db, { now }); assert.ok(s.meetingDrafts >= 1);
      await runCrmReminderJob(db, { now });
      const rows = await db.touchpoint.findMany({ where: { sourceId: m.id } });
      assert.equal(rows.length, 1); assert.equal(rows[0].status, "DRAFT"); assert.equal(rows[0].sourceType, "MEETING"); assert.equal(rows[0].notes, null);
    });
  } finally {
    try {
      if (previous) await db.crmSetting.update({ where: { key: previous.key }, data: { value: previous.value as Prisma.InputJsonValue, version: previous.version, updatedAt: previous.updatedAt } });
      else await db.crmSetting.deleteMany({ where: { key: "tier.cadenceWeeks" } });
    } finally { await db.$disconnect(); }
  }
});
