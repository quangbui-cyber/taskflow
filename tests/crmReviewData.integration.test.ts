import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { loadWeeklyReview, loadWeeklyReviewGroups, type WeeklyReview } from "../lib/crm/reviewData";
import { formatCrmWeekLabel } from "../lib/crm/dates";
import { crmTestDatabaseUrl, createCrmTestDb, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";

test("weekly review is scoped, ordered, permission-aware and read-only", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb(); const prefix = `review-${randomUUID()}`; const now = new Date("2026-11-11T03:00:00Z");
  const keys = ["tier.potentialScale", "tier.matrix", "review.priority"];
  const original = await db.crmSetting.findMany({ where: { key: { in: keys } } });
  let extraTeamId: string | undefined;
  try {
    const f = await seedCrmFixture(db, prefix);
    const actor = (user: typeof f.pic, extra = {}) => ({ id: user.id, role: user.role, accountId: user.id === f.pic.id ? f.picAccount.id : null, managedTeamIds: [] as string[], isDataSteward: false, ...extra });
    const pic = actor(f.pic), manager = actor(f.manager, { managedTeamIds: [f.team.id], accountId: f.otherAccount.id });
    const admin = actor(f.admin), outsider = actor(f.outsider), assignee = actor(f.assignee);
    const settings: Record<string, Prisma.InputJsonValue> = { "tier.potentialScale": [{ key: "HIGH", label: "High" }, { key: "LOW", label: "Low" }], "tier.matrix": { revenueBands: [{ key: "ALL", label: "All", minPercentile: 0 }], cells: { ALL: { HIGH: "S", LOW: "B" } } }, "review.priority": ["APPOINTMENT", "PLAN_CLOSE", "ESCALATED", "TIER"] };
    for (const key of keys) await db.crmSetting.upsert({ where: { key }, create: { key, value: settings[key] }, update: { value: settings[key], version: { increment: 1 } } });
    const client = (name: string, extra: Prisma.ClientUncheckedCreateInput = { name: "unused" }) => db.client.create({ data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id, ...extra, name: `${prefix} ${name}` } });
    const c1 = await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id, version: 3 } });
    const c2 = await client("C2", { name: "unused", picAccountId: null });
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { clientId: c2.id } });
    const unit = await db.buyingUnit.create({ data: { clientId: c2.id, name: "HR" } });
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { buyingUnitId: unit.id } });
    const c3 = await client("C3");
    const c4 = await client("C4", { name: "unused", picAccountId: null, responsibleTeamId: f.team.id });
    const appointment = await client("Appointment"), escalated = await client("Escalated"), scoredS = await client("Scored S", { name: "unused", potentialLevel: "HIGH" }), scoredB = await client("Scored B", { name: "unused", potentialLevel: "LOW" });
    const eventClient = await client("Event", { name: "unused", picAccountId: null });
    const anotherPic = await client("Another PIC", { name: "unused", picAccountId: f.otherAccount.id });
    const unDated = await client("Undated");
    const task = (name: string, clientId: string | null, extra = {}) => db.task.create({ data: { title: `${prefix} ${name}`, clientId, creatorId: f.pic.id, assigneeId: f.pic.id, dueDate: new Date("2026-11-10T16:59:00Z"), crmKind: "NEXT_STEP", ...extra } });
    const k1 = await task("C1 overdue", c1.id, { assigneeId: f.assignee.id });
    const k2 = await task("C2 saturday", null, { opportunityId: f.opportunity.id, dueDate: new Date("2026-11-14T03:00:00Z") });
    await task("Later ignored", c1.id, { dueDate: new Date("2026-11-12T03:00:00Z") });
    await task("Null ignored", c1.id, { dueDate: null });
    await task("Cancelled", c3.id, { status: "CANCELLED" }); await task("Done", c3.id, { status: "DONE" });
    await task("Appointment", appointment.id, { crmKind: "APPOINTMENT" });
    await task("Escalated", escalated.id, { escalatedAt: now });
    await task("Scored S", scoredS.id); await task("Scored B", scoredB.id);
    const otherTask = await task("Other PIC", anotherPic.id);
    await task("Undated", unDated.id, { dueDate: null });
    const reminderTask = await task("Reminder", eventClient.id, { crmKind: "EVENT_REMINDER", dueDate: new Date("2026-11-15T16:59:59Z") });
    const event = await db.expectedEvent.create({ data: { clientId: eventClient.id, programTypeCode: "MICE", precision: "MONTH", year: 2026, month: 12, source: "CLIENT_CONFIRMED" } });
    await db.reminderStep.create({ data: { expectedEventId: event.id, taskId: reminderTask.id, revision: 0, kind: "EVENT_REMINDER", dueDate: reminderTask.dueDate!, status: "OPEN" } });
    const meeting = await db.meeting.create({ data: { title: `${prefix} Public meeting title`, clientId: c1.id, organizerId: f.pic.id, startAt: now, endAt: new Date(now.getTime() + 3600000) } });
    await db.meetingRecap.create({ data: { meetingId: meeting.id, content: "SECRET_RECAP_BODY", status: "READY" } });
    const draft = await db.touchpoint.create({ data: { clientId: c1.id, kind: "MEETING", occurredAt: now, status: "DRAFT", sourceType: "MEETING", sourceId: meeting.id } });
    await db.touchpoint.create({ data: { clientId: c1.id, kind: "MEETING", occurredAt: now, status: "DISMISSED", sourceType: "MEETING", sourceId: `${prefix}-dismissed` } });
    await db.touchpoint.create({ data: { clientId: c1.id, kind: "CALL", occurredAt: new Date("2026-11-09T03:00:00Z"), status: "CONFIRMED", outcomeLevel: 2 } });
    await db.touchpoint.create({ data: { clientId: c1.id, kind: "MEETING", occurredAt: new Date("2026-11-08T03:00:00Z"), status: "CONFIRMED", outcomeLevel: 3 } });
    await db.project.create({ data: { name: `${prefix} Revenue`, ownerId: f.admin.id, clientId: c1.id, accountId: f.picAccount.id, revenue: 100, status: "ON_PROCESS", onProcessAt: new Date("2026-10-01") } });
    const flatten = (r: Awaited<ReturnType<typeof loadWeeklyReviewGroups>>) => Object.values(r.groups).flat();
    const rowFor = (r: Awaited<ReturnType<typeof loadWeeklyReviewGroups>>, id: string) => flatten(r).find((row) => row.client.id === id)!;
    const counts = () => Promise.all([db.task.count(), db.touchpoint.count(), db.reminderStep.count()]);
    const before = await counts();
    let review: WeeklyReview;
    await t.test("three groups choose actual earliest tasks and carry source, last touch and VN dates", async () => {
      review = await loadWeeklyReview(db, pic, {}, now);
      assert.equal(review.filters.teamId, f.team.id); assert.deepEqual(Object.keys(review.groups), ["OVERDUE", "DUE_THIS_WEEK", "NO_NEXT_STEP"]);
      assert.equal(rowFor(review, c1.id).group, "OVERDUE"); assert.equal(rowFor(review, c1.id).reason.lateDays, 1); assert.equal(rowFor(review, c1.id).taskId, k1.id);
      assert.equal(rowFor(review, c2.id).group, "DUE_THIS_WEEK"); assert.equal(rowFor(review, c2.id).opportunity?.id, f.opportunity.id); assert.equal(rowFor(review, c2.id).client.buyingUnitName, "HR"); assert.equal(rowFor(review, c2.id).prefill.completeTaskId, k2.id); assert.equal(rowFor(review, c2.id).prefill.opportunityId, f.opportunity.id);
      assert.equal(rowFor(review, c3.id).group, "NO_NEXT_STEP"); assert.equal(rowFor(review, c4.id), undefined); assert.equal(rowFor(review, unDated.id), undefined);
      assert.equal(rowFor(review, eventClient.id).reason.sourceLabel, "Khách xác nhận"); assert.equal(rowFor(review, c1.id).lastTouch?.kindLabel, "Gọi"); assert.equal(rowFor(review, c1.id).lastTouch?.outcomeLabel, "Có phản hồi thực chất");
      assert.equal(rowFor(review, c1.id).client.version, 3); for (const row of flatten(review)) assert.match(row.prefill.nextDueDate!, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(review.week.start.toISOString(), "2026-11-08T17:00:00.000Z"); assert.equal(review.week.label, formatCrmWeekLabel(review.week.mondayKey));
      assert.equal(review.metrics.overdue, review.groups.OVERDUE.length); assert.equal(review.metrics.dueThisWeek, review.groups.DUE_THIS_WEEK.length); assert.equal(review.metrics.noNextStep, review.groups.NO_NEXT_STEP.length); assert.equal(review.metrics.drafts, 1); assert.equal(review.drafts[0].id, draft.id); assert.equal(review.drafts[0].title, meeting.title); assert.ok(!JSON.stringify(review).includes("SECRET_RECAP_BODY"));
    });
    await t.test("priority then S / unrated / B ordering follows settings", async () => {
      const ids = review.groups.OVERDUE.map((r) => r.client.id);
      assert.equal(ids[0], appointment.id); assert.equal(ids[1], escalated.id); assert.ok(ids.indexOf(scoredS.id) < ids.indexOf(c1.id)); assert.ok(ids.indexOf(c1.id) < ids.indexOf(scoredB.id));
      await db.crmSetting.update({ where: { key: "review.priority" }, data: { value: ["TIER", "ESCALATED", "PLAN_CLOSE", "APPOINTMENT"] } });
      const reordered = await loadWeeklyReviewGroups(db, pic, { team: f.team.id }, now); assert.equal(reordered.groups.OVERDUE[0].client.id, scoredS.id);
      await db.crmSetting.update({ where: { key: "review.priority" }, data: { value: settings["review.priority"] } });
    });
    await t.test("mine pushdown excludes other PIC clients and narrow path omits full-only queries", async () => {
      const captured: Prisma.ClientWhereInput[] = []; const touchQueries: unknown[] = [];
      const scoped = db.$extends({ query: { client: { findMany({ args, query }) { captured.push(args.where ?? {}); return query(args); } }, touchpoint: { findMany({ args, query }) { touchQueries.push(args.where); return query(args); } } } }) as unknown as typeof db;
      const narrow = await loadWeeklyReviewGroups(scoped, pic, { team: "all", pic: "me" }, now);
      assert.ok(captured.some((where) => JSON.stringify(where).includes(`"picAccountId":"${f.picAccount.id}"`))); assert.equal(captured.length, 1); assert.ok(!touchQueries.some((where) => JSON.stringify(where).includes("DRAFT")));
      for (const key of ["drafts", "unrated", "teams", "pics"]) assert.ok(!(key in narrow));
      assert.ok(!flatten(narrow).some((row) => row.taskId === otherTask.id)); assert.ok(!flatten(narrow).some((row) => row.client.id === c2.id));
      const full = await loadWeeklyReview(db, pic, { team: "all", pic: "me" }, now); assert.deepEqual(narrow, { week: full.week, filters: full.filters, metrics: { overdue: full.metrics.overdue, dueThisWeek: full.metrics.dueThisWeek, noNextStep: full.metrics.noNextStep }, groups: full.groups, isEmpty: full.isEmpty });
      assert.ok(flatten(review).some((row) => row.taskId === otherTask.id)); assert.ok(full.pics.some((p) => p.accountId === f.otherAccount.id));
      const selected = await loadWeeklyReview(db, pic, { team: "all", pic: f.otherAccount.id }, now); assert.equal(selected.filters.pic, f.otherAccount.id); assert.deepEqual(flatten(selected).map((r) => r.client.id), [anotherPic.id]);
    });
    await t.test("unrated and row actions are authorized by Client/Opportunity/task resources", async () => {
      const m = await loadWeeklyReview(db, manager, { team: f.team.id }, now); const a = await loadWeeklyReview(db, admin, { team: f.team.id }, now); const o = await loadWeeklyReview(db, outsider, { team: f.team.id }, now); const assigned = await loadWeeklyReview(db, assignee, { team: f.team.id }, now);
      assert.ok(m.unrated.some((r) => r.clientId === c1.id && r.revenue24m === 100)); assert.ok(a.unrated.some((r) => r.clientId === c1.id)); assert.equal(review.unrated.length, 0); assert.equal(o.unrated.length, 0);
      assert.deepEqual(rowFor(o, c1.id).can, { logResult: false, assign: false, postpone: false, escalate: false, assignPic: false });
      assert.deepEqual(rowFor(review, c1.id).can, { logResult: true, assign: true, postpone: true, escalate: true, assignPic: false });
      assert.equal(rowFor(assigned, c1.id).can.logResult, true); assert.equal(rowFor(assigned, c1.id).can.assign, false);
      assert.equal(rowFor(m, c2.id).can.assignPic, true); assert.equal(rowFor(review, c2.id).can.assignPic, false); assert.equal(rowFor(m, c1.id).can.assignPic, false);
      assert.equal(m.potentialScaleConfigured, true); assert.equal(m.drafts[0].canConfirm, true); assert.equal(o.drafts[0].canConfirm, false);
    });
    await t.test("filtering by PIC never changes a client's company-wide revenue tier", async () => {
      await db.client.update({ where: { id: c1.id }, data: { potentialLevel: "HIGH" } });
      await db.project.create({ data: { name: `${prefix} Other revenue`, ownerId: f.admin.id, clientId: anotherPic.id, accountId: f.otherAccount.id, revenue: 1000, status: "ON_PROCESS", onProcessAt: new Date("2026-10-01") } });
      await db.crmSetting.update({ where: { key: "tier.matrix" }, data: { value: { revenueBands: [{ key: "LOW", label: "Low", minPercentile: 0 }, { key: "HIGH", label: "High", minPercentile: 90 }], cells: { LOW: { HIGH: "B", LOW: "C" }, HIGH: { HIGH: "S", LOW: "A" } } } } });
      const full = await loadWeeklyReview(db, pic, { team: "all", pic: "all" }, now);
      const mine = await loadWeeklyReviewGroups(db, pic, { team: "all", pic: "me" }, now);
      assert.equal(rowFor(full, c1.id).client.tier, "B"); assert.equal(rowFor(mine, c1.id).client.tier, "B");
      await db.crmSetting.update({ where: { key: "tier.matrix" }, data: { value: settings["tier.matrix"] } });
    });
    await t.test("other team and exclusive week end are excluded, empty shape has correct metrics", async () => {
      const team = await db.salesTeam.create({ data: { name: `${prefix} Other Team` } }); extraTeamId = team.id;
      const empty = await loadWeeklyReview(db, pic, { team: team.id }, now); assert.equal(empty.isEmpty, true); assert.deepEqual(empty.metrics, { overdue: 0, dueThisWeek: 0, noNextStep: 0, drafts: 0 });
      await db.task.update({ where: { id: reminderTask.id }, data: { dueDate: new Date("2026-11-15T17:00:00Z") } });
      const nextWeek = await loadWeeklyReviewGroups(db, pic, { team: f.team.id }, now); assert.equal(rowFor(nextWeek, eventClient.id), undefined);
    });
    assert.deepEqual(await counts(), before);
  } finally {
    try {
      for (const key of keys) { const old = original.find((s) => s.key === key); if (old) await db.crmSetting.update({ where: { key }, data: { value: old.value as Prisma.InputJsonValue, version: old.version, updatedById: old.updatedById, updatedAt: old.updatedAt } }); else await db.crmSetting.deleteMany({ where: { key } }); }
      if (extraTeamId) await db.salesTeam.delete({ where: { id: extraTeamId } });
      await cleanupCrmFixture(db, prefix);
    } finally { await db.$disconnect(); }
  }
});
