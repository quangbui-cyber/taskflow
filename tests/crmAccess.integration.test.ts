import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { crmEnabledForUser, crmDeniedForUser, filterCrmAllowedUserIds, listCrmAllowedUserIds } from "../lib/crm/access";
import { CRM_LIMITED_SOURCE_ERROR, getCrmSettings, saveCrmSetting } from "../lib/crm/settings";
import { assertOwnerAccess, assertTaskAccess, isValidAssignee } from "../lib/taskAccess";
import { assignCrmTask } from "../lib/crm/reviewActions";
import { runCrmReminderJob } from "../lib/crm/reminderJob";
import { myOpenTasksWhere } from "../lib/taskQueries";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

const KEY = "access.users";

test("crm54: CRM opens per person from access.users; others are denied in library guards, task lists and reminders", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const prefix = randomUUID();
  const previousFlag = process.env.CRM_ENABLED;
  // access.users is a single shared row; keep the exact original (or its absence) and put it back.
  const original = await db.crmSetting.findUnique({ where: { key: KEY } });
  const pipelineBefore = await db.crmSetting.findUniqueOrThrow({ where: { key: "pipeline.mode" } });
  const startedAt = new Date();
  const setList = async (ids: string[]) => {
    const version = (await getCrmSettings(db)).versions[KEY];
    const saved = await saveCrmSetting(db, { key: KEY, value: ids, expectedVersion: version, actor: f.admin });
    assert.ok("ok" in saved, JSON.stringify(saved));
  };
  let f!: Awaited<ReturnType<typeof seedCrmFixture>>;
  try {
    f = await seedCrmFixture(db, prefix);
    if (original) await db.crmSetting.update({ where: { key: KEY }, data: { value: [] } });
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const crmTask = await db.task.create({ data: { title: `${prefix} CRM task`, clientId: f.client.id, assigneeId: f.pic.id, creatorId: f.manager.id, status: "TODO", crmKind: "NEXT_STEP", dueDate: new Date() } });

    await t.test("flag off: nobody passes, Admin included, and library guards keep the old behaviour", async () => {
      delete process.env.CRM_ENABLED;
      assert.equal(await crmEnabledForUser(db, f.admin), false);
      assert.equal(await crmDeniedForUser(db, f.pic), false);
      assert.deepEqual(await filterCrmAllowedUserIds(db, [f.admin.id, f.pic.id]), []);
      assert.ok("task" in await assertTaskAccess(db, f.pic, crmTask.id, "VIEW"));
    });

    process.env.CRM_ENABLED = "true";

    await t.test("access.users save: strict value, active users only, CAS version and history", async () => {
      const version = (await getCrmSettings(db)).versions[KEY];
      for (const value of ["x", [1], [f.pic.id, f.pic.id], { users: [] }]) assert.deepEqual(await saveCrmSetting(db, { key: KEY, value, expectedVersion: version, actor: f.admin }), { error: "Cấu hình không hợp lệ." });
      await db.user.update({ where: { id: f.outsider.id }, data: { isActive: false } });
      assert.deepEqual(await saveCrmSetting(db, { key: KEY, value: [f.outsider.id], expectedVersion: version, actor: f.admin }), { error: "Cấu hình không hợp lệ." });
      await db.user.update({ where: { id: f.outsider.id }, data: { isActive: true } });
      const saved = await saveCrmSetting(db, { key: KEY, value: [f.pic.id], expectedVersion: version, actor: f.admin });
      assert.deepEqual(saved, { ok: true, version: version + 1 });
      assert.ok("error" in await saveCrmSetting(db, { key: KEY, value: [], expectedVersion: version, actor: f.admin }), "stale version must be rejected");
      const history = await db.crmSettingChange.findMany({ where: { key: KEY, userId: f.admin.id }, orderBy: { createdAt: "asc" } });
      assert.equal(history.length, 1);
      assert.deepEqual(history[0].newValue, [f.pic.id]);
      assert.deepEqual((await getCrmSettings(db)).accessUserIds, [f.pic.id]);
    });

    await t.test("Admin always passes; listed user passes; others are denied; change applies on the next read", async () => {
      await setList([]);
      assert.equal(await crmEnabledForUser(db, f.admin), true);
      for (const user of [f.pic, f.manager, f.assignee, f.outsider]) assert.equal(await crmEnabledForUser(db, user), false);
      await setList([f.pic.id]);
      assert.equal(await crmEnabledForUser(db, f.pic), true);
      assert.equal(await crmEnabledForUser(db, f.outsider), false);
      assert.deepEqual(await filterCrmAllowedUserIds(db, [f.admin.id, f.pic.id, f.outsider.id]), [f.admin.id, f.pic.id]);
      assert.ok((await listCrmAllowedUserIds(db)).includes(f.pic.id));
      await db.user.update({ where: { id: f.pic.id }, data: { isActive: false } });
      assert.equal(await crmEnabledForUser(db, f.pic), false, "disabled users are ignored even when listed");
      await db.user.update({ where: { id: f.pic.id }, data: { isActive: true } });
      await db.crmSetting.update({ where: { key: KEY }, data: { value: { broken: true } } });
      assert.equal(await crmEnabledForUser(db, f.pic), false, "malformed list reads as Admin only");
      assert.equal(await crmEnabledForUser(db, f.admin), true);
      await db.crmSetting.update({ where: { key: KEY }, data: { value: [] } });
    });

    await t.test("outside the list: owner/task access denied, not a valid assignee, CRM tasks hidden from the list", async () => {
      await setList([]);
      const owner = { kind: "CLIENT" as const, id: f.client.id };
      assert.ok("error" in await assertOwnerAccess(db, f.pic, owner, "VIEW"));
      assert.ok("error" in await assertTaskAccess(db, f.pic, crmTask.id, "VIEW"));
      assert.equal(await isValidAssignee(db, owner, f.pic.id), false);
      const visible = async () => db.task.count({ where: { AND: [myOpenTasksWhere(f.pic.id, await crmEnabledForUser(db, f.pic)), { id: crmTask.id }] } });
      assert.equal(await visible(), 0);
      const manager = { id: f.manager.id, name: f.manager.name, role: f.manager.role, accountId: f.otherAccount.id, managedTeamIds: [f.team.id], isDataSteward: false };
      assert.deepEqual(await assignCrmTask(db, manager, { taskId: crmTask.id, assigneeId: f.outsider.id, dueDate: new Date() }), { error: "Người này chưa được mở CRM." });
      await setList([f.pic.id]);
      assert.ok("ok" in await assertOwnerAccess(db, f.pic, owner, "VIEW"));
      assert.ok("task" in await assertTaskAccess(db, f.pic, crmTask.id, "VIEW"));
      assert.equal(await isValidAssignee(db, owner, f.pic.id), true);
      assert.equal(await visible(), 1);
    });

    await t.test("reminders create work only for clients whose PIC may use CRM", async () => {
      const scoped = db.$extends({ query: {
        client: { findMany({ args, query }) { return query({ ...args, where: { AND: [args.where ?? {}, { id: f.client.id }] } }); } },
        meeting: { findMany() { return Promise.resolve([]); } },
      } }) as unknown as typeof db;
      await db.task.update({ where: { id: crmTask.id }, data: { status: "DONE", completedAt: new Date() } });
      const now = new Date(Date.now() + 400 * 86_400_000);
      const before = await db.task.count({ where: { clientId: f.client.id } });
      const denied = await runCrmReminderJob(scoped, { now, allowedPicUserIds: [f.admin.id] });
      assert.equal(denied.cadenceTasks + denied.planCloseTasks + denied.openedSteps + (denied.renewalTasks ?? 0), 0);
      assert.equal(denied.notifications.length, 0);
      assert.equal(await db.task.count({ where: { clientId: f.client.id } }), before);
      const allowed = await runCrmReminderJob(scoped, { now, allowedPicUserIds: [f.admin.id, f.pic.id] });
      assert.ok(allowed.cadenceTasks >= 1, JSON.stringify(allowed));
      assert.ok(await db.task.count({ where: { clientId: f.client.id } }) > before);
    });

    await t.test("limited mode blocks moving the official report source to Cơ hội without writing", async () => {
      // Start from the production-like source (Project) regardless of the local baseline; the row is restored in finally.
      await db.crmSetting.update({ where: { key: "pipeline.mode" }, data: { value: { ...(pipelineBefore.value as Record<string, unknown>), mode: "PROJECT_OFFICIAL" } } });
      const staged = await db.crmSetting.findUniqueOrThrow({ where: { key: "pipeline.mode" } });
      const current = await getCrmSettings(db);
      const result = await saveCrmSetting(db, { key: "pipeline.mode", value: { ...current.pipelineMode, mode: "OPPORTUNITY_OFFICIAL" }, expectedVersion: current.versions["pipeline.mode"], actor: f.admin, limitedAccess: true });
      assert.deepEqual(result, { error: CRM_LIMITED_SOURCE_ERROR });
      assert.deepEqual(await db.crmSetting.findUniqueOrThrow({ where: { key: "pipeline.mode" } }), staged);
    });
  } finally {
    if (previousFlag === undefined) delete process.env.CRM_ENABLED; else process.env.CRM_ENABLED = previousFlag;
    try {
      if (original) {
        const { key, ...data } = original;
        await db.crmSetting.update({ where: { key }, data: { ...data, value: data.value as Prisma.InputJsonValue } });
      } else await db.crmSetting.deleteMany({ where: { key: KEY } });
      { const { key, ...data } = pipelineBefore; await db.crmSetting.update({ where: { key }, data: { ...data, value: data.value as Prisma.InputJsonValue } }); }
      await db.crmSettingChange.deleteMany({ where: { key: "pipeline.mode", createdAt: { gte: startedAt } } });
      if (f) await db.crmSettingChange.deleteMany({ where: { key: KEY, userId: f.admin.id } });
      await cleanupCrmFixture(db, prefix);
    } finally { await db.$disconnect(); }
  }
});
