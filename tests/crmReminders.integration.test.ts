import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createExpectedEvent, updateExpectedEvent, cancelExpectedEvent } from "../lib/crm/eventService";
import { assignCrmTask, postponeCrmTask, escalateCrmTask } from "../lib/crm/reviewActions";
import { createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";

test("expected events reschedule unfinished reminders and review actions enforce owner permissions", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb(); const prefix = `reminders-${randomUUID()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const actor = (user: typeof f.pic) => ({ id: user.id, name: user.name, role: user.role, accountId: user.id === f.pic.id ? f.picAccount.id : null, managedTeamIds: [], isDataSteward: false });
    const pic = actor(f.pic); const assignee = actor(f.assignee); const outsider = actor(f.outsider);
    const day = new Date(Date.now() + 120 * 86400000);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
    const input = { clientId: f.client.id, programTypeCode: "MICE", precision: "DAY", year: Number(key.slice(0, 4)), date: new Date(`${key}T00:00:00+07:00`), source: "CLIENT_CONFIRMED" };
    let eventId = "";
    await t.test("DAY creates three planned offsets; QUARTER only verifies month", async () => {
      const created = await createExpectedEvent(db, pic, input);
      assert.ok("ok" in created); assert.equal(created.steps, 3); eventId = created.eventId;
      const steps = await db.reminderStep.findMany({ where: { expectedEventId: eventId } });
      assert.equal(steps.length, 3); assert.ok(steps.every(s => s.status === "PLANNED" && s.revision === 0));
      const quarter = await createExpectedEvent(db, pic, { ...input, precision: "QUARTER", year: input.year + 1, quarter: 2, date: null });
      assert.ok("ok" in quarter); assert.equal(quarter.steps, 1);
      assert.equal((await db.reminderStep.findFirstOrThrow({ where: { expectedEventId: quarter.eventId } })).kind, "VERIFY_MONTH");
    });
    await t.test("date revision retargets OPEN tasks, preserves DONE and supersedes PLANNED", async () => {
      const rows = await db.reminderStep.findMany({ where: { expectedEventId: eventId }, orderBy: { offsetDays: "desc" } });
      const task = await db.task.create({ data: { title: `${prefix} Reminder`, creatorId: f.pic.id, assigneeId: f.assignee.id, clientId: f.client.id, dueDate: rows[0].dueDate, crmKind: "EVENT_REMINDER" } });
      await db.reminderStep.update({ where: { id: rows[0].id }, data: { status: "OPEN", taskId: task.id } });
      await db.reminderStep.update({ where: { id: rows[1].id }, data: { status: "DONE" } });
      const nextDate = new Date(input.date.getTime() + 10 * 86400000);
      const updated = await updateExpectedEvent(db, pic, { ...input, eventId, date: nextDate, year: Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(nextDate)) });
      assert.ok("ok" in updated); assert.equal(updated.recomputed, 2);
      assert.equal((await db.expectedEvent.findUniqueOrThrow({ where: { id: eventId } })).revision, 1);
      const open = await db.reminderStep.findUniqueOrThrow({ where: { id: rows[0].id } });
      assert.equal(open.status, "OPEN"); assert.equal(open.dueDate.getTime(), rows[0].dueDate.getTime() + 10 * 86400000);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).dueDate?.getTime(), open.dueDate.getTime());
      assert.equal((await db.reminderStep.findUniqueOrThrow({ where: { id: rows[1].id } })).status, "DONE");
      assert.equal((await db.reminderStep.findUniqueOrThrow({ where: { id: rows[1].id } })).dueDate.getTime(), rows[1].dueDate.getTime());
      assert.equal((await db.reminderStep.findUniqueOrThrow({ where: { id: rows[2].id } })).status, "SUPERSEDED");
      assert.equal(await db.reminderStep.count({ where: { expectedEventId: eventId, status: "PLANNED", revision: 1 } }), 1);
    });
    const task = await db.task.create({ data: { title: `${prefix} Care`, creatorId: f.pic.id, assigneeId: f.assignee.id, clientId: f.client.id, crmKind: "NEXT_STEP" } });
    await t.test("postpone requires reason/date, keeps actor history and rejects outsiders", async () => {
      const reviewDate = new Date(Date.now() + 86400000);
      assert.ok("error" in await postponeCrmTask(db, assignee, { taskId: task.id, reason: "", reviewDate }));
      assert.ok("error" in await postponeCrmTask(db, outsider, { taskId: task.id, reason: "Wait", reviewDate }));
      assert.ok("ok" in await postponeCrmTask(db, assignee, { taskId: task.id, reason: "Waiting on client", reviewDate }));
      const history = await db.taskPostpone.findFirstOrThrow({ where: { taskId: task.id } });
      assert.equal(history.reason, "Waiting on client"); assert.equal(history.actorName, f.assignee.name); assert.equal(history.actorId, f.assignee.id);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).dueDate?.getTime(), reviewDate.getTime());
    });
    await t.test("assignee can escalate, outsider cannot assign/escalate", async () => {
      assert.ok("error" in await escalateCrmTask(db, outsider, task.id));
      assert.ok("ok" in await escalateCrmTask(db, assignee, task.id));
      assert.ok((await db.task.findUniqueOrThrow({ where: { id: task.id } })).escalatedAt);
      assert.ok("error" in await assignCrmTask(db, assignee, { taskId: task.id, assigneeId: f.outsider.id, dueDate: day }));
      assert.ok("error" in await assignCrmTask(db, outsider, { taskId: task.id, assigneeId: f.outsider.id, dueDate: day }));
    });
    await t.test("PIC assigns an active person with owner-linked notification", async () => {
      const assigned = await assignCrmTask(db, pic, { taskId: task.id, assigneeId: f.outsider.id, dueDate: day });
      assert.ok("ok" in assigned);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId, f.outsider.id);
      assert.equal(await db.notification.count({ where: { taskId: task.id, userId: f.outsider.id, clientId: f.client.id, type: "CRM_TASK_ASSIGNED" } }), 1);
      await db.user.update({ where: { id: f.outsider.id }, data: { isActive: false } });
      assert.ok("error" in await assignCrmTask(db, pic, { taskId: task.id, assigneeId: f.outsider.id, dueDate: day }));
    });
    await t.test("invalid/foreign events cannot mutate; cancellation closes only open work", async () => {
      assert.ok("error" in await createExpectedEvent(db, outsider, input));
      for (const extra of [{ precision: "DAY", date: new Date(NaN) }, { precision: "MONTH", month: 13, date: null }, { source: "OTHER" }, { buyingUnitId: "missing" }, { programTypeCode: "UNKNOWN" }]) assert.ok("error" in await createExpectedEvent(db, pic, { ...input, ...extra }));
      assert.ok("error" in await updateExpectedEvent(db, outsider, { ...input, eventId }));
      assert.ok("error" in await cancelExpectedEvent(db, outsider, eventId));
      assert.ok("ok" in await cancelExpectedEvent(db, pic, eventId));
      const rows = await db.reminderStep.findMany({ where: { expectedEventId: eventId }, include: { task: true } });
      assert.equal((await db.expectedEvent.findUniqueOrThrow({ where: { id: eventId } })).status, "CANCELLED");
      assert.ok(rows.some(row => row.status === "DONE"));
      assert.ok(rows.filter(row => row.taskId).every(row => row.task?.status === "CANCELLED" && row.task.closedReason === "Sự kiện dự kiến đã hủy"));
      assert.ok("error" in await updateExpectedEvent(db, pic, { ...input, eventId }));
    });
  } finally { try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); } }
});
