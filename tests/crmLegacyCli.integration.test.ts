import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { assertMigrationTarget, parseMigrationArgs, runMigrationCommand } from "../lib/crm/migrationCli";
import { deserializeSnapshotRow } from "../lib/crm/legacyMapping";
import { getCrmSettings } from "../lib/crm/settings";
import { loadReconciliationInput, recognizedRevenueByMonth, type ReconciliationReport } from "../lib/crm/reconciliation";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

async function fixture(db: PrismaClient, prefix: string) {
  const f = await seedCrmFixture(db, prefix);
  const make = (name: string, status: string, extra = {}) => db.project.create({ data: { name: `${prefix} ${name}`, category: "CLIENT", status, clientId: f.client.id, ownerId: f.admin.id, accountId: f.picAccount.id, type: "MICE", createdAt: new Date("2026-08-01Z"), ...extra } });
  const bid = await make("BID", "BIDDING", { revenue: 500_000_000, googleChatSpaceName: "spaces/synthetic" }), fail = await make("FAIL", "FAIL"), old = await make("OLD", "FAIL", { createdAt: new Date("2026-06-01Z") });
  const cancel = await make("CANCEL", "CANCEL", { onProcessAt: new Date("2026-10-01Z") }), on = await make("ON", "ON_PROCESS", { revenue: 1_200_000_000, onProcessAt: new Date("2026-09-30T17:30:00Z") }), blocked = await make("BLOCKED", "BIDDING"), missing = await make("MISSING", "BIDDING", { clientId: null });
  await db.financeSheet.create({ data: { projectId: blocked.id } });
  await db.projectMember.createMany({ data: [bid, fail, old, on].flatMap((p) => [f.admin.id, f.assignee.id].map((userId) => ({ projectId: p.id, userId }))) });
  await db.projectWish.create({ data: { projectId: bid.id, authorId: f.admin.id, body: "synthetic wish" } });
  await db.task.createMany({ data: [1, 2].map((n) => ({ projectId: bid.id, creatorId: f.admin.id, title: `${prefix} task${n}` })) });
  await db.projectFile.create({ data: { projectId: bid.id, name: "synthetic.txt", mimeType: "text/plain", size: 2, data: Buffer.from("ok") } });
  await db.meeting.create({ data: { projectId: bid.id, title: `${prefix} meeting`, organizerId: f.admin.id, startAt: new Date("2026-12-01Z"), endAt: new Date("2026-12-01T01:00Z") } });
  await db.notification.create({ data: { userId: f.admin.id, projectId: bid.id, type: "TEST", message: "synthetic" } });
  await db.driveFolder.create({ data: { key: `project:${bid.id}`, folderId: prefix, name: "synthetic" } });
  return { ...f, bid, fail, old, cancel, on, blocked, missing, ids: [bid, fail, old, cancel, on, blocked, missing].map((p) => p.id) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function withFixture(run: (db: PrismaClient, f: Fixture, ctx: Awaited<ReturnType<typeof context>>) => Promise<void>) {
  const db = createCrmTestDb(), prefix = `cli-${randomUUID()}`, original = await db.crmSetting.findUniqueOrThrow({ where: { key: "pipeline.mode" } }), dir = await mkdtemp(path.join(os.tmpdir(), "crm-cli-"));
  try {
    const f = await fixture(db, prefix);
    await db.crmSetting.update({ where: { key: "pipeline.mode" }, data: { value: { mode: "PROJECT_OFFICIAL", pilotTeamIds: [f.team.id], plannedCutoverDate: "2026-12-01" }, version: { increment: 1 } } });
    await run(db, f, await context(db, f, dir));
  } finally {
    await db.crmSettingChange.deleteMany({ where: { userName: `${prefix} admin` } });
    await db.crmSetting.update({ where: { key: "pipeline.mode" }, data: { value: original.value!, version: original.version, updatedById: original.updatedById, updatedAt: original.updatedAt } });
    await db.driveFolder.deleteMany({ where: { folderId: prefix } });
    await db.crmMigrationBatch.deleteMany({ where: { OR: [{ actorName: `${prefix} admin` }, { actorName: prefix }] } });
    await cleanupCrmFixture(db, prefix);
    await rm(dir, { recursive: true, force: true }); await db.$disconnect();
  }
}
async function context(db: PrismaClient, f: Fixture, dir: string) {
  const logs: string[] = [], target = new URL(crmTestDatabaseUrl()!);
  const deps = { now: () => new Date("2026-11-09T00:00Z"), databaseHost: `${target.hostname}${target.pathname}`, log: (s: string) => logs.push(s), writeFile: async (file: string, content: string) => { await writeFile(file, content, "utf8"); }, readTextFile: async (file: string) => { try { return await readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } } };
  const args = (...argv: string[]) => parseMigrationArgs(["--year=2026", `--out=${dir}`, `--actor-email=${f.admin.email}`, ...argv]);
  const run = (...argv: string[]) => runMigrationCommand(db, args(...argv), deps);
  const dry = async (ids = f.ids) => { const r = await run("--dry-run", `--project-ids=${ids.join(",")}`); assert.equal(r.exitCode, 0, logs.join("\n")); assert.ok(r.batchId); return r; };
  const report = async (r: { reportPaths: string[] }) => JSON.parse(await readFile(r.reportPaths.find((p) => p.endsWith(".json"))!, "utf8")) as ReconciliationReport;
  const dump = async () => ({ projects: await db.project.findMany({ where: { id: { in: f.ids } }, orderBy: { id: "asc" } }), opportunities: await db.opportunity.findMany({ where: { clientId: f.client.id }, orderBy: { id: "asc" } }), members: await db.projectMember.findMany({ where: { projectId: { in: f.ids } }, orderBy: { id: "asc" } }), tasks: await db.task.findMany({ where: { creatorId: f.admin.id }, orderBy: { id: "asc" } }), files: await db.projectFile.findMany({ where: { OR: [{ projectId: { in: f.ids } }, { opportunity: { clientId: f.client.id } }] }, orderBy: { id: "asc" } }), meetings: await db.meeting.findMany({ where: { organizerId: f.admin.id }, orderBy: { id: "asc" } }), notifications: await db.notification.findMany({ where: { userId: f.admin.id }, orderBy: { id: "asc" } }), drive: await db.driveFolder.findMany({ where: { folderId: { startsWith: "cli-" } }, orderBy: { key: "asc" } }), wishes: await db.projectWish.findMany({ where: { projectId: { in: f.ids } }, orderBy: { id: "asc" } }) });
  return { logs, dir, deps, args, run, dry, report, dump };
}

test("CLI dry-run, explicit approval apply and rollback restore the full synthetic fixture", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, c) => {
  const before = await c.dump(), mode = (await getCrmSettings(db)).pipelineMode, revenue = recognizedRevenueByMonth(await loadReconciliationInput(db), 2026);
  const dry = await c.dry(); assert.deepEqual(await c.dump(), before); assert.deepEqual((await getCrmSettings(db)).pipelineMode, mode);
  const report = await c.report(dry); assert.ok(report.classifications.needsReview.some((r) => r.projectId === f.old.id)); assert.ok(report.classifications.blocked.some((r) => r.projectId === f.blocked.id)); assert.ok(report.classifications.missingClient.some((r) => r.projectId === f.missing.id));
  assert.equal(report.winRate.causes.find((r) => r.key === "CANCEL_AFTER_WIN")?.count, 1); assert.ok((await readFile(dry.reportPaths[1], "utf8")).startsWith("\uFEFF"));
  const batchCount = await db.crmMigrationBatch.count();
  assert.equal((await c.run("--apply", `--batch=${dry.batchId}`, `--approve-review-ids=${f.blocked.id}`)).exitCode, 1);
  assert.equal(await db.crmMigrationBatch.count(), batchCount); assert.deepEqual(await c.dump(), before);
  const file = path.join(c.dir, "approved.txt"); await writeFile(file, `# synthetic review only\n${f.old.id}\n${f.old.id}\n`);
  const applied = await c.run("--apply", `--batch=${dry.batchId}`, `--approve-review-ids=${file}`); assert.equal(applied.exitCode, 0, c.logs.join("\n")); assert.notEqual(applied.batchId, dry.batchId);
  assert.equal(await db.project.count({ where: { id: { in: [f.bid.id, f.fail.id, f.old.id] } } }), 0);
  const opps = await db.opportunity.findMany({ where: { legacyProjectId: { in: f.ids } } }); assert.equal(opps.length, 3);
  const bid = opps.find((o) => o.legacyProjectId === f.bid.id)!; assert.equal(bid.budgetMax?.toNumber(), 500_000_000);
  assert.equal(await db.task.count({ where: { opportunityId: bid.id, projectId: null } }), 2); assert.equal(await db.projectFile.count({ where: { opportunityId: bid.id, projectId: null } }), 1); assert.equal(await db.meeting.count({ where: { opportunityId: bid.id, projectId: null } }), 1);
  const batch = await db.crmMigrationBatch.findUniqueOrThrow({ where: { id: applied.batchId! } }), summary = deserializeSnapshotRow<Record<string, unknown>>(batch.summary);
  assert.equal(summary.sourceDryRunBatchId, dry.batchId); assert.deepEqual(summary.approvedReviewIds, [f.old.id]); assert.deepEqual(summary.previousPipelineMode, mode);
  assert.deepEqual(recognizedRevenueByMonth(await loadReconciliationInput(db), 2026), revenue); assert.deepEqual((await getCrmSettings(db)).pipelineMode, { ...mode, mode: "OPPORTUNITY_OFFICIAL" });
  const post = await c.report(applied); assert.equal(post.failedCountChange.find((r) => r.userId === f.assignee.id)?.diff, -2); assert.equal(post.officialFailedCountChange.find((r) => r.userId === f.assignee.id)?.diff, 0); assert.equal(post.kpiRevenueInvariant.equal, true);
  const restored = await c.run("--rollback", `--batch=${applied.batchId}`); assert.equal(restored.exitCode, 0, c.logs.join("\n")); assert.deepEqual(await c.dump(), before); assert.deepEqual((await getCrmSettings(db)).pipelineMode, mode);
  assert.equal((await c.report(restored)).revenueInvariant.equal, true);
  const again = await c.dry(), reapplied = await c.run("--apply", `--batch=${again.batchId}`); assert.equal(reapplied.exitCode, 0);
  assert.equal(await db.project.count({ where: { id: f.old.id } }), 1);
  const moved = await db.opportunity.findUniqueOrThrow({ where: { legacyProjectId: f.bid.id } });
  await db.opportunityStageEvent.create({ data: { opportunityId: moved.id, toStage: "BIDDING", actorName: "synthetic new activity", occurredAt: new Date() } });
  const blocked = await c.run("--rollback", `--batch=${reapplied.batchId}`); assert.equal(blocked.exitCode, 1); assert.ok(c.logs.some((s) => s.includes(moved.id) && s.includes("NEW_STAGE_EVENT"))); assert.equal((await getCrmSettings(db)).pipelineMode.mode, "OPPORTUNITY_OFFICIAL");
}));
test("CLI refuses stale dry-run, inactive/non-admin actors and dev target without a query", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, c) => {
  const dry = await c.dry(); await db.project.update({ where: { id: f.bid.id }, data: { purchaseOrderNumber: "synthetic PO" } });
  const before = await c.dump(), count = await db.crmMigrationBatch.count();
  assert.equal((await c.run("--apply", `--batch=${dry.batchId}`)).exitCode, 1); assert.ok(c.logs.some((s) => s.includes(f.bid.id) && s.includes("changed"))); assert.deepEqual(await c.dump(), before); assert.equal(await db.crmMigrationBatch.count(), count);
  for (const email of [null, f.manager.email]) {
    assert.equal((await runMigrationCommand(db, { ...c.args("--apply", `--batch=${dry.batchId}`), actorEmail: email }, c.deps)).exitCode, 1);
  }
  await db.user.update({ where: { id: f.admin.id }, data: { isActive: false } }); assert.equal((await c.run("--apply", `--batch=${dry.batchId}`)).exitCode, 1);
  assert.throws(() => assertMigrationTarget("postgresql://u:x@localhost/taskflow", {}, c.args()));
  let queried = false; const forbidden = new Proxy({} as PrismaClient, { get() { queried = true; throw new Error("query forbidden"); } });
  await assert.rejects(runMigrationCommand(forbidden, c.args(), { ...c.deps, databaseHost: "localhost/taskflow" })); assert.equal(queried, false);
}));
test("CLI detects a one-VND KPI/revenue mismatch and automatically rolls back", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, c) => {
  const dry = await c.dry([f.bid.id]), before = await c.dump();
  const tampered = db.$extends({ query: { project: { async findMany({ args, query }) { const rows = await query(args); if (args.select?.onProcessAt && !rows.some((r) => r.id === f.bid.id)) return rows.map((r) => r.id === f.on.id ? { ...r, revenue: r.revenue + 1 } : r); return rows; } } } }) as unknown as PrismaClient;
  const result = await runMigrationCommand(tampered, c.args("--apply", `--batch=${dry.batchId}`), c.deps);
  assert.equal(result.exitCode, 1); assert.ok(result.batchId); assert.equal((await db.crmMigrationBatch.findUniqueOrThrow({ where: { id: result.batchId } })).status, "ROLLED_BACK"); assert.deepEqual(await c.dump(), before);
  assert.equal((await getCrmSettings(db)).pipelineMode.mode, "PROJECT_OFFICIAL"); assert.equal((await c.report(result)).revenueInvariant.equal, false);
}));
test("CLI restores the original pipeline source after multiple batches roll back in either order", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, c) => {
  const original = (await getCrmSettings(db)).pipelineMode;
  const a = await c.dry([f.bid.id]), applyA = await c.run("--apply", `--batch=${a.batchId}`); assert.equal(applyA.exitCode, 0);
  const b = await c.dry([f.fail.id]), applyB = await c.run("--apply", `--batch=${b.batchId}`); assert.equal(applyB.exitCode, 0);
  assert.equal((await c.run("--rollback", `--batch=${applyA.batchId}`)).exitCode, 0); assert.equal((await getCrmSettings(db)).pipelineMode.mode, "OPPORTUNITY_OFFICIAL");
  assert.equal((await c.run("--rollback", `--batch=${applyB.batchId}`)).exitCode, 0); assert.deepEqual((await getCrmSettings(db)).pipelineMode, original);
}));
