import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadMyCrmFocus, HOME_FOCUS_LIMIT } from "../lib/crm/homeFocus";
import { loadWeeklyReviewGroups } from "../lib/crm/reviewData";
import { crmTestDatabaseUrl, createCrmTestDb, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";

test("home focus shares the PIC review without copying tasks", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb(), prefix = `home-${randomUUID()}`;
  const now = new Date("2026-11-11T03:00:00Z");
  let extraTeamId: string | undefined;
  try {
    const f = await seedCrmFixture(db, prefix);
    const a = await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const b = await db.client.create({ data: { name: `${prefix} B`, picAccountId: f.picAccount.id } });
    const c = await db.client.create({ data: { name: `${prefix} C`, picAccountId: f.picAccount.id, budgetSeasonMonth: 11 } });
    const d = await db.client.create({ data: { name: `${prefix} D`, picAccountId: f.otherAccount.id } });
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { clientId: c.id } });
    const task = (clientId: string, crmKind: string, dueDate: Date) => db.task.create({ data: { title: `${prefix} Reach`, clientId, crmKind, dueDate, creatorId: f.pic.id, assigneeId: f.pic.id } });
    const ta = await task(a.id, "NEXT_STEP", new Date("2026-11-08T03:00:00Z"));
    const tb = await task(b.id, "CADENCE", new Date("2026-11-15T16:59:59Z"));
    await task(d.id, "NEXT_STEP", new Date("2026-11-01T03:00:00Z"));
    const counts = () => Promise.all([db.task.count(), db.touchpoint.count(), db.reminderStep.count()]);
    const before = await counts();
    await t.test("overdue then Sunday cadence, capped at two and scoped to PIC", async () => {
      const focus = await loadMyCrmFocus(db, f.pic, now);
      assert.equal(HOME_FOCUS_LIMIT, 2); assert.equal(focus.isPic, true);
      assert.deepEqual(focus.rows, [
        { clientId: a.id, clientName: a.name, reason: "Bước tiếp theo", dueLabel: "hạn 08/11" },
        { clientId: b.id, clientName: b.name, reason: "Nhắc định kỳ", dueLabel: "hạn 15/11" },
      ]);
      const review = await loadWeeklyReviewGroups(db, { id: f.pic.id, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false }, { team: "all", pic: "me" }, now);
      assert.deepEqual(focus.rows.map((r) => r.clientId), [...review.groups.OVERDUE, ...review.groups.DUE_THIS_WEEK, ...review.groups.NO_NEXT_STEP].slice(0, 2).map((r) => r.client.id));
      assert.deepEqual(await counts(), before);
    });
    await t.test("closed Opportunity tasks are ignored", async () => {
      const closed = await db.opportunity.create({ data: { name: `${prefix} Closed`, clientId: a.id, stage: "CARE", outcome: "CUSTOMER_CANCELLED", programTypeCode: "MICE", expectedYear: 2026, source: "OTHER", demandSignal: "Synthetic closed deal" } });
      await db.task.create({ data: { title: `${prefix} Closed task`, opportunityId: closed.id, creatorId: f.pic.id, crmKind: "APPOINTMENT", dueDate: new Date("2026-10-01T00:00:00Z") } });
      assert.equal((await loadMyCrmFocus(db, f.pic, now)).rows[0].reason, "Bước tiếp theo");
    });
    await t.test("DONE and CANCELLED do not count as next steps", async () => {
      await db.task.update({ where: { id: ta.id }, data: { status: "DONE" } });
      await db.task.update({ where: { id: tb.id }, data: { status: "CANCELLED" } });
      const focus = await loadMyCrmFocus(db, f.pic, now);
      assert.equal(focus.rows[0].clientId, c.id); assert.equal(focus.rows[0].reason, "Chưa có bước tiếp theo");
      assert.ok(focus.rows.every((r) => r.dueLabel === null));
    });
    await t.test("PIC with only future tasks has an empty card", async () => {
      for (const clientId of [a.id, b.id, c.id]) await task(clientId, "NEXT_STEP", new Date("2026-12-15T03:00:00Z"));
      assert.deepEqual(await loadMyCrmFocus(db, f.pic, now), { isPic: true, rows: [] });
    });
    await t.test("assignee-only user exits after one cheap client count", async () => {
      await db.task.update({ where: { id: ta.id }, data: { assigneeId: f.assignee.id } });
      const queries: string[] = [];
      const observed = db.$extends({ query: { $allModels: { $allOperations({ model, operation, args, query }) { queries.push(`${model}.${operation}`); return query(args); } } } }) as unknown as typeof db;
      assert.deepEqual(await loadMyCrmFocus(observed, f.assignee, now), { isPic: false, rows: [] });
      assert.deepEqual(queries, ["Client.count"]);
    });
    await t.test("PIC's client in another team remains visible", async () => {
      const other = await db.salesTeam.create({ data: { name: `${prefix} Other Team` } }); extraTeamId = other.id;
      await db.client.update({ where: { id: a.id }, data: { responsibleTeamId: other.id } });
      await db.task.update({ where: { id: ta.id }, data: { status: "TODO" } });
      assert.equal((await loadMyCrmFocus(db, f.pic, now)).rows[0].clientId, a.id);
    });
    await t.test("Monday 01:00 VN includes the following Sunday", async () => {
      await db.task.update({ where: { id: ta.id }, data: { status: "DONE" } });
      await db.task.update({ where: { id: tb.id }, data: { status: "TODO" } });
      const focus = await loadMyCrmFocus(db, f.pic, new Date("2026-11-08T18:00:00Z"));
      assert.equal(focus.rows[0].clientId, b.id); assert.equal(focus.rows[0].dueLabel, "hạn 15/11");
    });
    await t.test("inactive PIC is rejected using stored identity", async () => {
      await db.user.update({ where: { id: f.pic.id }, data: { isActive: false } });
      await assert.rejects(loadMyCrmFocus(db, { id: f.pic.id, role: "ADMIN" }, now), /không còn hoạt động/);
    });
  } finally {
    try {
      if (extraTeamId) await db.client.updateMany({ where: { responsibleTeamId: extraTeamId }, data: { responsibleTeamId: null } });
      if (extraTeamId) await db.salesTeam.delete({ where: { id: extraTeamId } });
      await cleanupCrmFixture(db, prefix);
    } finally { await db.$disconnect(); }
  }
});
