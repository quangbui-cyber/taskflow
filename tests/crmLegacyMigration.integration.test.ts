import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { planLegacyMigration, recordDryRun, createApplyBatch, applyLegacyBatch, rollbackLegacyBatch, detectNewActivity, LegacyApprovalError } from "../lib/crm/legacyMigration";
import { closeOpportunity } from "../lib/crm/opportunityWorkflow";
import { LEGACY_IMPORT_ACTOR_NAME } from "../lib/crm/legacyMapping";
import { emptyMonths, KPI_RECOGNIZED_STATUSES, kpiYearRange, vietnamYearMonth } from "../lib/kpi";
import { LEGACY_WON_STATUSES, LEGACY_LOST_STATUSES } from "../lib/crm/metrics";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

async function monthlyRevenue(db: PrismaClient, clientId: string) {
  const range = kpiYearRange(2026), months = emptyMonths();
  for (const p of await db.project.findMany({ where: { clientId, category: "CLIENT", status: { in: KPI_RECOGNIZED_STATUSES }, onProcessAt: { gte: range.start, lt: range.end } } })) if (p.onProcessAt) months[vietnamYearMonth(p.onProcessAt).month - 1] += p.revenue;
  return months;
}
async function fixture(db: PrismaClient, prefix: string) {
  const f = await seedCrmFixture(db, prefix);
  const make = (suffix: string, status: string, extra = {}) => db.project.create({ data: { name: `${prefix} ${suffix}`, status, clientId: f.client.id, ownerId: f.admin.id, accountId: f.picAccount.id, type: "MICE", createdAt: new Date("2026-08-01Z"), ...extra } });
  const bid = await make("BID", "BIDDING", { revenue: 300_000_000, description: "Snapshot all fields", googleChatSpaceName: "spaces/test", googleChatSpaceUri: "https://chat.google.com/test", googleChatSpaceById: f.admin.id });
  const fail = await make("FAIL", "FAIL"), cancel = await make("CANCEL", "CANCEL"), old = await make("OLD", "FAIL", { createdAt: new Date("2026-07-01Z") });
  const fin = await make("FIN", "BIDDING"), noClient = await make("NOCLIENT", "BIDDING", { clientId: null });
  const wonCancel = await make("WONCANCEL", "CANCEL", { onProcessAt: new Date("2026-08-02Z"), revenue: 400 });
  const internal = await make("INTERNAL", "BIDDING", { category: "INTERNAL" });
  const on = await make("ON", "ON_PROCESS", { revenue: 600, onProcessAt: new Date("2026-09-30T18:00:00Z") });
  await db.financeSheet.create({ data: { projectId: fin.id } });
  await db.projectMember.createMany({ data: [f.admin.id, f.assignee.id].map((userId) => ({ projectId: bid.id, userId })) });
  await db.projectWish.create({ data: { projectId: bid.id, authorId: f.admin.id, body: "Historical wish" } });
  await db.task.createMany({ data: [1, 2].map((n) => ({ projectId: bid.id, creatorId: f.admin.id, title: `${prefix} task ${n}` })) });
  await db.projectFile.create({ data: { projectId: bid.id, name: "file", mimeType: "text/plain", size: 2, data: Buffer.from("ok") } });
  await db.meeting.create({ data: { projectId: bid.id, title: `${prefix} meeting`, organizerId: f.admin.id, startAt: new Date("2026-12-01Z"), endAt: new Date("2026-12-01T01:00Z") } });
  const notification = await db.notification.create({ data: { userId: f.admin.id, projectId: bid.id, type: "TEST", message: "Legacy notification" } });
  await db.driveFolder.createMany({ data: ["", ":docs"].map((suffix) => ({ key: `project:${bid.id}${suffix}`, folderId: `${prefix}${suffix}`, name: "Legacy folder" })) });
  return { ...f, bid, fail, cancel, old, fin, noClient, wonCancel, internal, on, notification, ids: [bid, fail, cancel, old, fin, noClient, wonCancel, internal, on].map((p) => p.id) };
}
async function withFixture(run: (db: PrismaClient, f: Awaited<ReturnType<typeof fixture>>, prefix: string) => Promise<void>) {
  const db = createCrmTestDb(), prefix = `legacy-${randomUUID()}`;
  try { await run(db, await fixture(db, prefix), prefix); }
  finally {
    await db.driveFolder.deleteMany({ where: { folderId: { startsWith: prefix } } });
    await db.crmMigrationBatch.deleteMany({ where: { actorName: prefix } });
    await cleanupCrmFixture(db, prefix); await db.$disconnect();
  }
}
const options = (prefix: string) => ({ actorName: prefix, databaseHost: "localhost" });

test("legacy plan counts and dry-run leave all business rows unchanged", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  assert.ok(LEGACY_WON_STATUSES.includes(f.on.status)); assert.ok(LEGACY_LOST_STATUSES.includes(f.fail.status));
  const plan = await planLegacyMigration(db, { projectIds: f.ids });
  assert.deepEqual(plan.totals, { MIGRATE: 3, NEEDS_REVIEW: 1, BLOCKED: 1, MISSING_CLIENT: 1 });
  assert.deepEqual(plan.rows.find((r) => r.projectId === f.bid.id)?.counts, { tasks: 2, files: 1, meetings: 1, members: 2, wishes: 1, notifications: 1, driveKeys: 2 });
  assert.equal(plan.rows.find((r) => r.projectId === f.bid.id)?.hasChatSpace, true);
  const dump = async () => ({ projects: await db.project.findMany({ where: { id: { in: f.ids } }, orderBy: { id: "asc" } }), tasks: await db.task.findMany({ where: { creatorId: f.admin.id } }), files: await db.projectFile.findMany({ where: { projectId: f.bid.id } }), meetings: await db.meeting.findMany({ where: { organizerId: f.admin.id } }), opps: await db.opportunity.findMany({ where: { clientId: f.client.id } }), drive: await db.driveFolder.findMany({ where: { folderId: { startsWith: prefix } } }), notification: await db.notification.findUnique({ where: { id: f.notification.id } }) });
  const before = await dump(), batchId = await recordDryRun(db, plan, options(prefix));
  assert.deepEqual(await dump(), before);
  const batch = await db.crmMigrationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { migrationBatchRecords: true } });
  assert.equal(batch.mode, "DRY_RUN"); assert.equal(batch.status, "DRY_RUN_DONE"); assert.equal(batch.migrationBatchRecords.length, 6);
  assert.ok(batch.migrationBatchRecords.every((r) => r.status === "PLANNED" && JSON.stringify(r.snapshot) === "{}"));
}));
test("apply moves every owner atomically, preserves KPI, and is idempotent", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  const before = await monthlyRevenue(db, f.client.id), plan = await planLegacyMigration(db, { projectIds: f.ids });
  const { batchId } = await createApplyBatch(db, plan, { ...options(prefix), projectIds: f.ids });
  assert.equal((await applyLegacyBatch(db, batchId)).applied, 3);
  const opps = await db.opportunity.findMany({ where: { legacyProjectId: { in: f.ids } } }); assert.equal(opps.length, 3);
  const bid = opps.find((o) => o.legacyProjectId === f.bid.id)!;
  assert.equal(bid.stage, "BIDDING"); assert.equal(bid.outcome, null); assert.equal(bid.budgetMax?.toNumber(), 300_000_000);
  assert.equal(opps.find((o) => o.legacyProjectId === f.fail.id)?.legacyStatus, "FAIL");
  assert.ok(opps.filter((o) => o.id !== bid.id).every((o) => o.outcome === "LEGACY_UNCLASSIFIED"));
  assert.equal(await db.project.count({ where: { id: { in: [f.bid.id, f.fail.id, f.cancel.id] } } }), 0);
  assert.equal(await db.project.count({ where: { id: { in: [f.old.id, f.fin.id, f.noClient.id] } } }), 3);
  for (const rows of [await db.task.findMany({ where: { creatorId: f.admin.id } }), await db.projectFile.findMany({ where: { opportunityId: bid.id } }), await db.meeting.findMany({ where: { organizerId: f.admin.id } })]) { assert.ok(rows.length); assert.ok(rows.every((r) => r.projectId === null && r.opportunityId === bid.id)); }
  assert.equal(await db.opportunityMember.count({ where: { opportunityId: bid.id } }), 2);
  const note = await db.notification.findUniqueOrThrow({ where: { id: f.notification.id } }); assert.equal(note.projectId, null); assert.equal(note.opportunityId, bid.id);
  assert.deepEqual((await db.driveFolder.findMany({ where: { folderId: { startsWith: prefix } }, orderBy: { key: "asc" } })).map((r) => r.key), [`opportunity:${bid.id}`, `opportunity:${bid.id}:docs`]);
  assert.equal((await db.opportunityStageEvent.findFirstOrThrow({ where: { opportunityId: bid.id } })).actorName, LEGACY_IMPORT_ACTOR_NAME);
  assert.deepEqual(await monthlyRevenue(db, f.client.id), before);
  assert.equal((await applyLegacyBatch(db, batchId)).applied, 0); assert.equal(await db.opportunity.count({ where: { legacyProjectId: { in: f.ids } } }), 3);
  assert.equal((await planLegacyMigration(db, { projectIds: f.ids })).totals.MIGRATE, 0);
}));
test("review approvals are batch-local, validate before writes and preserve summary metadata", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  const plan = await planLegacyMigration(db, { projectIds: f.ids }), sourceDryRunBatchId = await recordDryRun(db, plan, options(prefix));
  for (const id of [f.fin.id, f.noClient.id, "unknown"]) {
    const before = await db.crmMigrationBatch.count();
    await assert.rejects(createApplyBatch(db, plan, { ...options(prefix), approvedReviewIds: [id] }), (error: unknown) => error instanceof LegacyApprovalError && error.invalidIds[0].projectId === id);
    assert.equal(await db.crmMigrationBatch.count(), before);
  }
  const without = await createApplyBatch(db, plan, { ...options(prefix), projectIds: [f.old.id] }); assert.equal(without.planned, 0);
  const approved = await createApplyBatch(db, plan, { ...options(prefix), projectIds: [f.old.id], approvedReviewIds: [f.old.id], sourceDryRunBatchId }); assert.equal(approved.planned, 1);
  const expected = { sourceDryRunBatchId, approvedReviewIds: [f.old.id] };
  assert.deepEqual((await db.crmMigrationBatch.findUniqueOrThrow({ where: { id: approved.batchId } })).summary, expected);
  await db.crmMigrationBatch.update({ where: { id: approved.batchId }, data: { summary: { ...expected, previousPipelineMode: "PROJECT_OFFICIAL" } } });
  assert.equal((await applyLegacyBatch(db, approved.batchId)).applied, 1);
  const summary = (await db.crmMigrationBatch.findUniqueOrThrow({ where: { id: approved.batchId } })).summary as Record<string, unknown>;
  assert.equal(summary.sourceDryRunBatchId, sourceDryRunBatchId); assert.deepEqual(summary.approvedReviewIds, [f.old.id]); assert.equal(summary.previousPipelineMode, "PROJECT_OFFICIAL");
}));
test("state changes between plan and apply skip the changed Project", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  const plan = await planLegacyMigration(db, { projectIds: [f.cancel.id] }), { batchId } = await createApplyBatch(db, plan, options(prefix));
  await db.project.update({ where: { id: f.cancel.id }, data: { status: "ON_PROCESS", onProcessAt: new Date() } });
  const result = await applyLegacyBatch(db, batchId);
  assert.deepEqual(result, { applied: 0, skipped: [{ legacyProjectId: f.cancel.id, reason: "STATE_CHANGED" }], status: "PARTIAL" });
  assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.cancel.id } })).status, "ON_PROCESS");
}));

async function dumpFixture(db: PrismaClient, f: Awaited<ReturnType<typeof fixture>>, prefix: string) {
  const orderBy = { id: "asc" as const };
  return {
    projects: await db.project.findMany({ where: { id: { in: f.ids } }, orderBy }),
    members: await db.projectMember.findMany({ where: { projectId: { in: f.ids } }, orderBy }),
    wishes: await db.projectWish.findMany({ where: { projectId: { in: f.ids } }, orderBy }),
    tasks: await db.task.findMany({ where: { creatorId: f.admin.id }, select: { id: true, projectId: true, opportunityId: true }, orderBy }),
    files: await db.projectFile.findMany({ where: { OR: [{ projectId: { in: f.ids } }, { opportunity: { legacyProjectId: { in: f.ids } } }] }, select: { id: true, projectId: true, opportunityId: true }, orderBy }),
    meetings: await db.meeting.findMany({ where: { organizerId: f.admin.id }, select: { id: true, projectId: true, opportunityId: true }, orderBy }),
    notification: await db.notification.findUnique({ where: { id: f.notification.id }, select: { id: true, projectId: true, opportunityId: true } }),
    drive: await db.driveFolder.findMany({ where: { folderId: { startsWith: prefix } }, orderBy: { folderId: "asc" } }),
  };
}
async function applyFixture(db: PrismaClient, f: Awaited<ReturnType<typeof fixture>>, prefix: string, ids = f.ids) {
  const plan = await planLegacyMigration(db, { projectIds: ids }), { batchId } = await createApplyBatch(db, plan, options(prefix));
  await applyLegacyBatch(db, batchId); return batchId;
}
test("rollback restores exact Project scalars, members, wishes, owners and Drive keys with KPI unchanged", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  const before = await dumpFixture(db, f, prefix), revenue = await monthlyRevenue(db, f.client.id), batchId = await applyFixture(db, f, prefix);
  const result = await rollbackLegacyBatch(db, batchId, options(prefix)); assert.ok("ok" in result); assert.equal(result.restored, 3);
  assert.deepEqual(await dumpFixture(db, f, prefix), before); assert.deepEqual(await monthlyRevenue(db, f.client.id), revenue);
  assert.equal(await db.opportunity.count({ where: { legacyProjectId: { in: f.ids } } }), 0);
  assert.equal((await db.crmMigrationBatch.findUniqueOrThrow({ where: { id: batchId } })).status, "ROLLED_BACK");
  assert.equal(await db.crmMigrationRecord.count({ where: { batchId, status: "ROLLED_BACK" } }), 3);
  assert.deepEqual((await db.crmMigrationBatch.findUniqueOrThrow({ where: { id: result.rollbackBatchId } })).summary, { rolledBackBatchId: batchId });
  const again = await rollbackLegacyBatch(db, batchId, options(prefix)); assert.ok("ok" in again); assert.equal(again.restored, 0); assert.equal(again.rollbackBatchId, result.rollbackBatchId);
}));
test("new task blocks whole batch without writes; another independent batch can roll back", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  const batchId = await applyFixture(db, f, prefix, [f.bid.id, f.fail.id]);
  const opp = await db.opportunity.findUniqueOrThrow({ where: { legacyProjectId: f.bid.id } });
  await db.task.create({ data: { title: `${prefix} NEW`, creatorId: f.admin.id, opportunityId: opp.id } });
  const dump = async () => ({ fixture: await dumpFixture(db, f, prefix), batches: await db.crmMigrationBatch.findMany({ where: { actorName: prefix }, orderBy: { id: "asc" } }), records: await db.crmMigrationRecord.findMany({ where: { batchId }, orderBy: { id: "asc" } }) });
  const before = await dump(), result = await rollbackLegacyBatch(db, batchId, options(prefix)); assert.ok("blocked" in result);
  assert.deepEqual(result.blocked, [{ legacyProjectId: f.bid.id, opportunityId: opp.id, reasons: ["NEW_TASK"] }]); assert.deepEqual(await dump(), before);
  const independent = await applyFixture(db, f, prefix, [f.cancel.id]); assert.ok("ok" in await rollbackLegacyBatch(db, independent, options(prefix)));
  assert.equal((await db.crmMigrationBatch.findUniqueOrThrow({ where: { id: batchId } })).status, "APPLIED");
  assert.equal(await db.opportunity.count({ where: { legacyProjectId: { in: [f.bid.id, f.fail.id] } } }), 2);
}));
test("workflow stage events and confirmed touchpoints prevent rollback", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  const batchId = await applyFixture(db, f, prefix, [f.bid.id]), opp = await db.opportunity.findUniqueOrThrow({ where: { legacyProjectId: f.bid.id } });
  const actor = { id: f.admin.id, name: f.admin.name, role: "ADMIN", accountId: null, managedTeamIds: [], isDataSteward: false };
  const reason = await db.crmReason.findFirstOrThrow({ where: { group: "CANCELLED", active: true, requiresNote: false } });
  const closed = await closeOpportunity(db, actor, { opportunityId: opp.id, expectedVersion: 0, outcome: "CUSTOMER_CANCELLED", reasonId: reason.id }); assert.ok("ok" in closed);
  await db.touchpoint.create({ data: { clientId: f.client.id, opportunityId: opp.id, kind: "CALL", occurredAt: new Date(), outcomeLevel: 2, status: "CONFIRMED", authorId: f.admin.id } });
  const result = await rollbackLegacyBatch(db, batchId, options(prefix)); assert.ok("blocked" in result);
  assert.ok(result.blocked[0].reasons.includes("NEW_STAGE_EVENT")); assert.ok(result.blocked[0].reasons.includes("NEW_TOUCHPOINT")); assert.ok(result.blocked[0].reasons.includes("STAGE_OR_OUTCOME_CHANGED"));
}));
test("activity detector covers files, meetings, won Project and missing Opportunity", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  const batchId = await applyFixture(db, f, prefix, [f.bid.id]), record = await db.crmMigrationRecord.findFirstOrThrow({ where: { batchId } }), opportunityId = record.opportunityId!;
  await db.projectFile.create({ data: { opportunityId, name: "new", mimeType: "text/plain", size: 0 } });
  await db.meeting.create({ data: { opportunityId, title: "new", organizerId: f.admin.id, startAt: new Date(), endAt: new Date() } });
  await db.project.create({ data: { name: `${prefix} WON`, ownerId: f.admin.id, sourceOpportunityId: opportunityId } });
  const reasons = await detectNewActivity(db, record);
  assert.ok(reasons.includes("NEW_FILE")); assert.ok(reasons.includes("NEW_MEETING")); assert.ok(reasons.includes("WON_PROJECT_EXISTS"));
  await db.opportunity.delete({ where: { id: opportunityId } });
  assert.deepEqual(await detectNewActivity(db, record), ["OPPORTUNITY_MISSING"]);
}));
test("rollback failure is atomic and retryable across the whole batch", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  const batchId = await applyFixture(db, f, prefix), before = await dumpFixture(db, f, prefix);
  let creates = 0;
  const failing = db.$extends({ query: { project: { async create({ args, query }) { if (++creates === 2) throw new Error("synthetic restore failure"); return query(args); } } } }) as unknown as PrismaClient;
  await assert.rejects(rollbackLegacyBatch(failing, batchId, options(prefix)), /synthetic restore failure/);
  assert.deepEqual(await dumpFixture(db, f, prefix), before); assert.equal(await db.crmMigrationRecord.count({ where: { batchId, status: "APPLIED" } }), 3);
  assert.ok("ok" in await rollbackLegacyBatch(db, batchId, options(prefix)));
}));
test("apply transaction failure leaves snapshot and all owners retryable", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  const before = await dumpFixture(db, f, prefix), plan = await planLegacyMigration(db, { projectIds: [f.bid.id] });
  const { batchId } = await createApplyBatch(db, plan, options(prefix));
  const failing = db.$extends({ query: { driveFolder: { async update() { throw new Error("synthetic rename failure"); } } } }) as unknown as PrismaClient;
  await assert.rejects(applyLegacyBatch(failing, batchId), /synthetic rename failure/);
  assert.deepEqual(await dumpFixture(db, f, prefix), before);
  const record = await db.crmMigrationRecord.findFirstOrThrow({ where: { batchId } }); assert.equal(record.status, "PLANNED"); assert.equal(record.opportunityId, null);
  assert.equal(await db.opportunity.count({ where: { legacyProjectId: f.bid.id } }), 0);
  assert.equal((await applyLegacyBatch(db, batchId)).applied, 1);
}));
test("concurrent batches cannot migrate one Project twice, dry-run batches cannot apply", { skip: !crmTestDatabaseUrl() }, () => withFixture(async (db, f, prefix) => {
  const plan = await planLegacyMigration(db, { projectIds: [f.bid.id] });
  const dry = await recordDryRun(db, plan, options(prefix)); await assert.rejects(applyLegacyBatch(db, dry), /active APPLY/);
  const a = await createApplyBatch(db, plan, options(prefix)), b = await createApplyBatch(db, plan, options(prefix));
  const result = await Promise.all([applyLegacyBatch(db, a.batchId), applyLegacyBatch(db, b.batchId)]);
  assert.equal(result.reduce((n, r) => n + r.applied, 0), 1);
  assert.ok(result.some((r) => r.skipped.some((s) => s.reason === "ALREADY_MIGRATED")));
  assert.equal(await db.opportunity.count({ where: { legacyProjectId: f.bid.id } }), 1);
}));
