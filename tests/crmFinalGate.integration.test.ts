import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rmdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { vietnamYearMonth } from "../lib/kpi";
import type { ReconciliationReport } from "../lib/crm/reconciliation";
import { assertCrmTestDb, cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("the real migration CLI refuses unsafe targets and round-trips only the synthetic scope", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const url = crmTestDatabaseUrl()!;
  assertCrmTestDb(url);
  assert.equal(new URL(url).pathname, "/taskflow_crm_test");
  const db = createCrmTestDb();
  const prefix = `gate-${randomUUID()}`;
  const dir = await mkdtemp(path.join(os.tmpdir(), "taskflow-crm-final-"));
  const original = await db.crmSetting.findUniqueOrThrow({ where: { key: "pipeline.mode" } });
  const invoke = (args: string[], target = url) => spawnSync(process.execPath,
    ["--import", "tsx", "scripts/crm/migrate-legacy-projects.ts", `--out=${dir}`, "--year=2026", ...args],
    { cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 30_000,
      env: { ...process.env, DATABASE_URL: target, DIRECT_URL: target, TZ: "Asia/Ho_Chi_Minh", CRM_MIGRATION_ALLOWED_DATABASES: "" } },
  );
  const totals = async () => {
    const rows = await db.project.findMany({
      where: { status: { in: ["ON_PROCESS", "DONE"] }, onProcessAt: { not: null } },
      select: { revenue: true, onProcessAt: true }, orderBy: { id: "asc" },
    });
    const months: Record<string, { revenue: number; count: number }> = {};
    for (const row of rows) {
      const { year, month } = vietnamYearMonth(row.onProcessAt!);
      const entry = months[`${year}-${month}`] ??= { revenue: 0, count: 0 };
      entry.revenue += row.revenue;
      entry.count++;
    }
    return months;
  };
  const report = async (batch: string, phase: string) =>
    JSON.parse(await readFile(path.join(dir, `${batch}-${phase}.json`), "utf8")) as ReconciliationReport;
  let actorEmail: string | undefined;
  let actorName: string | undefined;
  let dryId: string | undefined;
  let applyId: string | undefined;
  let cleanupSafe = true;
  try {
    const f = await seedCrmFixture(db, prefix);
    actorEmail = f.admin.email;
    actorName = f.admin.name;
    const project = (name: string, status: string, extra: Partial<{ category: "CLIENT" | "INTERNAL"; clientId: string | null; revenue: number; onProcessAt: Date }> = {}) =>
      db.project.create({ data: {
        name, status, category: "CLIENT", clientId: f.client.id, ownerId: f.admin.id,
        accountId: f.picAccount.id, type: "MICE", createdAt: new Date("2026-08-01T00:00Z"), ...extra,
      } });
    const [bid, fail, review, blocked, wonCancelled, internal, control, recognized] = await Promise.all([
      project(`${prefix} Bidding`, "BIDDING", { revenue: 200_000_000 }),
      project(`${prefix} Fail`, "FAIL"),
      project(`${prefix} Cancel review`, "CANCEL", { revenue: 30_000_000 }),
      project(`${prefix} Finance`, "BIDDING"),
      project(`${prefix} Won cancelled`, "CANCEL", { onProcessAt: new Date("2026-09-30T17:30Z") }),
      project(`${prefix} Internal`, "BIDDING", { category: "INTERNAL", clientId: null }),
      project(`gate-ctl-${randomUUID()}`, "BIDDING"),
      project(`${prefix} Recognized control`, "ON_PROCESS", { revenue: 117_000_000, onProcessAt: new Date("2026-09-30T17:30Z") }),
    ]);
    const ids = [bid.id, fail.id, review.id, blocked.id, wonCancelled.id, internal.id];
    const scope = `--project-ids=${ids.join(",")}`;
    await db.financeSheet.create({ data: { projectId: blocked.id } });
    await db.projectMember.createMany({ data: [f.admin.id, f.assignee.id].map((userId) => ({ projectId: bid.id, userId })) });
    const tasks = await Promise.all([1, 2].map((i) => db.task.create({ data: { projectId: bid.id, creatorId: f.admin.id, title: `${prefix} work ${i}` } })));
    const file = await db.projectFile.create({ data: { projectId: bid.id, name: `${prefix}.txt`, mimeType: "text/plain", size: 2, data: Buffer.from("ok") } });
    const meeting = await db.meeting.create({ data: { projectId: bid.id, title: `${prefix} meeting`, organizerId: f.admin.id, startAt: new Date("2026-11-08T03:00Z"), endAt: new Date("2026-11-08T04:00Z") } });
    const notice = await db.notification.create({ data: { userId: f.admin.id, projectId: bid.id, type: "TEST", message: `${prefix} notice` } });
    const folder = await db.driveFolder.create({ data: { key: `project:${bid.id}`, folderId: prefix, name: prefix } });
    const nonFixture = () => db.project.findMany({ where: { id: { notIn: ids } }, select: { id: true, status: true }, orderBy: { id: "asc" } });
    const counts = () => Promise.all([db.project.count(), db.opportunity.count(), db.task.count(), db.projectFile.count(), db.meeting.count(), db.notification.count(), db.driveFolder.count()]);
    const audit = () => Promise.all([db.crmMigrationBatch.count(), db.crmMigrationRecord.count()]);
    const members = () => db.projectMember.findMany({ where: { projectId: bid.id }, orderBy: { id: "asc" } });
    const initialMembers = await members();
    const initialTotals = await totals();
    const initialCounts = await counts();
    const initialAudit = await audit();
    const outsideBefore = await nonFixture();
    const outsideIds = outsideBefore.map(({ id }) => id);
    const outsideSources = () => db.opportunity.findMany({ where: { legacyProjectId: { in: outsideIds } }, select: { id: true, legacyProjectId: true }, orderBy: { id: "asc" } });
    const outsideSourcesBefore = await outsideSources();

    await t.test("refuses a non-allowlisted target before constructing the DB client", async () => {
      const denied = invoke(["--apply", "--batch=gate-refusal"], "postgresql://u:p@db.example.invalid:5432/taskflow_crm_gate_refusal");
      assert.equal(denied.status, 1);
      assert.match(denied.stderr, /CRM_MIGRATION_ALLOWED_DATABASES/);
      assert.deepEqual(await counts(), initialCounts);
      assert.deepEqual(await audit(), initialAudit);
    });

    await t.test("dry-run records only the intended scope and leaves business rows intact", async () => {
      const dry = invoke(["--dry-run", scope, `--actor-email=${f.admin.email}`]);
      assert.equal(dry.status, 0, dry.stderr || dry.stdout);
      const batch = await db.crmMigrationBatch.findFirstOrThrow({ where: { actorName: f.admin.name, mode: "DRY_RUN" } });
      dryId = batch.id;
      assert.ok(dry.stdout.includes(batch.id));
      const records = await db.crmMigrationRecord.findMany({ where: { batchId: batch.id }, select: { legacyProjectId: true } });
      assert.deepEqual(records.map((row) => row.legacyProjectId).sort(), [bid.id, fail.id, review.id, blocked.id].sort());
      const classification = (await report(batch.id, "dry-run")).classifications;
      assert.deepEqual(classification.migrate.map((row) => row.projectId).sort(), [bid.id, fail.id].sort());
      assert.deepEqual(classification.needsReview.map((row) => row.projectId), [review.id]);
      assert.deepEqual(classification.blocked.map((row) => row.projectId), [blocked.id]);
      assert.deepEqual(await counts(), initialCounts);
      assert.deepEqual(await audit(), [initialAudit[0] + 1, initialAudit[1] + 4]);
      assert.deepEqual(await totals(), initialTotals);
    });

    await t.test("apply moves only candidates from the scoped dry-run and preserves lineage", async () => {
      assert.ok(dryId);
      // The live CLI permits --project-ids on dry-run only. Apply inherits the recorded IDs.
      const applied = invoke(["--apply", "--switch-source", `--batch=${dryId}`, `--actor-email=${f.admin.email}`]);
      const batch = await db.crmMigrationBatch.findFirst({ where: { actorName: f.admin.name, mode: "APPLY" } });
      applyId = batch?.id;
      assert.equal(applied.status, 0, applied.stderr || applied.stdout);
      assert.ok(applyId && applied.stdout.includes(applyId));
      const migrated = await db.opportunity.findUniqueOrThrow({ where: { legacyProjectId: bid.id } });
      assert.equal(migrated.outcome, null);
      assert.equal(migrated.stage, "BIDDING");
      const failed = await db.opportunity.findUniqueOrThrow({ where: { legacyProjectId: fail.id } });
      assert.equal(failed.outcome, "LEGACY_UNCLASSIFIED");
      assert.equal(failed.legacyStatus, "FAIL");
      assert.equal(await db.project.count({ where: { id: { in: [bid.id, fail.id] } } }), 0);
      for (const row of [review, blocked, wonCancelled, internal, control, recognized]) {
        assert.deepEqual(await db.project.findUnique({ where: { id: row.id } }), row);
      }
      for (const moved of [
        ...await db.task.findMany({ where: { id: { in: tasks.map(({ id }) => id) } } }),
        await db.projectFile.findUniqueOrThrow({ where: { id: file.id } }),
        await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } }),
        await db.notification.findUniqueOrThrow({ where: { id: notice.id } }),
      ]) {
        assert.equal(moved.projectId, null);
        assert.equal(moved.opportunityId, migrated.id);
      }
      assert.equal((await db.driveFolder.findUniqueOrThrow({ where: { folderId: prefix } })).key, `opportunity:${migrated.id}`);
      assert.deepEqual(await nonFixture(), outsideBefore);
      assert.deepEqual(await outsideSources(), outsideSourcesBefore);
      const setting = await db.crmSetting.findUniqueOrThrow({ where: { key: "pipeline.mode" } });
      assert.equal((setting.value as { mode: string }).mode, "OPPORTUNITY_OFFICIAL");
    });

    await t.test("all-company recognized revenue and project counts keep their Vietnam months", async () => {
      assert.ok(applyId);
      assert.deepEqual(await totals(), initialTotals);
      const evidence = await report(applyId, "post-apply");
      assert.equal(evidence.revenueInvariant.equal, true);
      assert.equal(evidence.kpiRevenueInvariant.equal, true);
    });

    await t.test("rollback restores Project identities, owners, members, notifications and pipeline mode", async () => {
      assert.ok(applyId);
      const rolled = invoke(["--rollback", `--batch=${applyId}`, `--actor-email=${f.admin.email}`]);
      assert.equal(rolled.status, 0, rolled.stderr || rolled.stdout);
      for (const row of [bid, fail]) assert.deepEqual(await db.project.findUnique({ where: { id: row.id } }), row);
      for (const task of tasks) {
        const restored = await db.task.findUniqueOrThrow({ where: { id: task.id } });
        assert.deepEqual({ ...restored, updatedAt: task.updatedAt }, task);
      }
      assert.deepEqual(await db.projectFile.findUnique({ where: { id: file.id } }), file);
      const restoredMeeting = await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
      assert.deepEqual({ ...restoredMeeting, updatedAt: meeting.updatedAt }, meeting);
      assert.deepEqual(await db.notification.findUnique({ where: { id: notice.id } }), notice);
      assert.deepEqual(await db.driveFolder.findUnique({ where: { folderId: prefix } }), folder);
      assert.deepEqual(await members(), initialMembers);
      assert.equal(await db.opportunity.count({ where: { legacyProjectId: { in: ids } } }), 0);
      assert.deepEqual((await db.crmSetting.findUniqueOrThrow({ where: { key: "pipeline.mode" } })).value, original.value);
      assert.deepEqual(await totals(), initialTotals);
      assert.equal((await report(applyId, "post-rollback")).kpiRevenueInvariant.equal, true);
    });
  } finally {
    try {
      if (applyId && actorEmail) {
        const batch = await db.crmMigrationBatch.findUnique({ where: { id: applyId } });
        if (batch && ["APPLIED", "PARTIAL"].includes(batch.status)) {
          cleanupSafe = invoke(["--rollback", `--batch=${applyId}`, `--actor-email=${actorEmail}`]).status === 0;
        }
      }
      assert.ok(cleanupSafe, `Synthetic rollback requires inspection. Batch ${applyId}`);
      await db.crmSetting.update({ where: { key: original.key }, data: {
        value: original.value!, version: original.version, updatedById: original.updatedById, updatedAt: original.updatedAt,
      } });
      await db.driveFolder.deleteMany({ where: { folderId: prefix } });
      if (actorName) {
        await db.crmSettingChange.deleteMany({ where: { userName: actorName } });
        await db.crmMigrationBatch.deleteMany({ where: { actorName } });
      }
      await cleanupCrmFixture(db, prefix);
      for (const entry of await readdir(dir)) await unlink(path.join(dir, entry));
      await rmdir(dir);
    } finally {
      await db.$disconnect();
    }
  }
});
