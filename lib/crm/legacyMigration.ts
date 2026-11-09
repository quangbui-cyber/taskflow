import { randomUUID } from "node:crypto";
import type { CrmMigrationRecord, Prisma, PrismaClient, Project, ProjectMember, ProjectWish } from "@prisma/client";
import { classifyLegacyProject, legacyClosedAtSource, legacyDriveKeyPairs, LEGACY_IMPORT_ACTOR_NAME, mapLegacyProjectToOpportunity, serializeSnapshotRow, deserializeSnapshotRow, type LegacyClassification } from "./legacyMapping";

type Db = PrismaClient | Prisma.TransactionClient;
export type LegacyPlanRow = { projectId: string; name: string; status: string; classification: LegacyClassification; reasons: string[]; counts: { tasks: number; files: number; meetings: number; members: number; wishes: number; notifications: number; driveKeys: number }; hasChatSpace: boolean };
export type LegacyPlan = { rows: LegacyPlanRow[]; totals: Record<LegacyClassification, number>; generatedAt: Date };
type Operator = { actorName: string; databaseHost: string };
type Snapshot = { project: Project; members: ProjectMember[]; wishes: ProjectWish[]; taskIds: string[]; fileIds: string[]; meetingIds: string[]; notificationIds: string[]; driveKeyPairs: { from: string; to: string }[]; driveFolders: { key: string; updatedAt: Date }[]; closedAtSource: string; stageEventIds: string[] };
const jsonObject = (value: Prisma.JsonValue | null): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const snapshotJson = (value: unknown) => serializeSnapshotRow(value) as Prisma.InputJsonObject;

/** One query per dataset, with grouped counts rather than one query per Project. */
export async function planLegacyMigration(db: Db, opts: { projectIds?: string[] } = {}): Promise<LegacyPlan> {
  const where: Prisma.ProjectWhereInput = { ...(opts.projectIds ? { id: { in: opts.projectIds } } : {}), category: "CLIENT", status: { in: ["BIDDING", "FAIL", "CANCEL"] }, onProcessAt: null, completedAt: null, purchaseOrderNumber: null, sourceOpportunityId: null };
  const projects = await db.project.findMany({ where, orderBy: { id: "asc" } });
  const ids = projects.map((p) => p.id), ownerWhere = { projectId: { in: ids } };
  const [tasks, files, meetings, members, wishes, notifications, finance, migrated, drive] = await Promise.all([
    db.task.groupBy({ by: ["projectId"], where: ownerWhere, _count: true }), db.projectFile.groupBy({ by: ["projectId"], where: ownerWhere, _count: true }),
    db.meeting.groupBy({ by: ["projectId"], where: ownerWhere, _count: true }), db.projectMember.groupBy({ by: ["projectId"], where: ownerWhere, _count: true }),
    db.projectWish.groupBy({ by: ["projectId"], where: ownerWhere, _count: true }), db.notification.groupBy({ by: ["projectId"], where: ownerWhere, _count: true }),
    db.financeSheet.groupBy({ by: ["projectId", "icStatus"], where: ownerWhere, _count: true }),
    db.opportunity.findMany({ where: { legacyProjectId: { in: ids } }, select: { legacyProjectId: true } }),
    db.driveFolder.findMany({ where: { OR: ids.flatMap((id) => [{ key: `project:${id}` }, { key: { startsWith: `project:${id}:` } }]) }, select: { key: true } }),
  ]);
  const counts = (rows: { projectId: string | null; _count: number }[]) => new Map(rows.map((r) => [r.projectId, r._count]));
  const maps = { tasks: counts(tasks), files: counts(files), meetings: counts(meetings), members: counts(members), wishes: counts(wishes), notifications: counts(notifications) };
  const totals = { MIGRATE: 0, NEEDS_REVIEW: 0, BLOCKED: 0, MISSING_CLIENT: 0 }, rows: LegacyPlanRow[] = [];
  for (const p of projects) {
    const sheets = finance.filter((f) => f.projectId === p.id);
    const classification = classifyLegacyProject({ ...p, financeSheetCount: sheets.reduce((n, r) => n + r._count, 0), approvedIcFinanceSheetCount: sheets.filter((r) => r.icStatus === "APPROVED").reduce((n, r) => n + r._count, 0), alreadyMigrated: migrated.some((r) => r.legacyProjectId === p.id) });
    if (!classification) continue;
    totals[classification.classification]++;
    rows.push({ projectId: p.id, name: p.name, status: p.status, ...classification, hasChatSpace: !!(p.googleChatSpaceName || p.googleChatSpaceUri), counts: { tasks: maps.tasks.get(p.id) ?? 0, files: maps.files.get(p.id) ?? 0, meetings: maps.meetings.get(p.id) ?? 0, members: maps.members.get(p.id) ?? 0, wishes: maps.wishes.get(p.id) ?? 0, notifications: maps.notifications.get(p.id) ?? 0, driveKeys: legacyDriveKeyPairs(p.id, "", drive.map((r) => r.key)).length } });
  }
  return { rows, totals, generatedAt: new Date() };
}
export async function recordDryRun(db: PrismaClient, plan: LegacyPlan, operator: Operator): Promise<string> {
  const batch = await db.crmMigrationBatch.create({ data: { ...operator, mode: "DRY_RUN", status: "DRY_RUN_DONE", finishedAt: new Date(), summary: plan.totals,
    migrationBatchRecords: { create: plan.rows.map((r) => ({ legacyProjectId: r.projectId, classification: r.classification, status: "PLANNED", snapshot: {} })) } } });
  return batch.id;
}
export class LegacyApprovalError extends Error {
  constructor(public invalidIds: { projectId: string; classification: string | null }[]) { super("Only NEEDS_REVIEW rows of this plan may be approved"); this.name = "LegacyApprovalError"; }
}
export async function createApplyBatch(db: PrismaClient, plan: LegacyPlan, opts: Operator & { projectIds?: string[]; approvedReviewIds?: string[]; sourceDryRunBatchId?: string }): Promise<{ batchId: string; planned: number }> {
  const approvedReviewIds = [...new Set(opts.approvedReviewIds ?? [])];
  const invalidIds = approvedReviewIds.map((projectId) => ({ projectId, classification: plan.rows.find((r) => r.projectId === projectId)?.classification ?? null })).filter((r) => r.classification !== "NEEDS_REVIEW");
  if (invalidIds.length) throw new LegacyApprovalError(invalidIds);
  const rows = plan.rows.filter((r) => (!opts.projectIds || opts.projectIds.includes(r.projectId)) && (r.classification === "MIGRATE" || r.classification === "NEEDS_REVIEW" && approvedReviewIds.includes(r.projectId)));
  const batch = await db.crmMigrationBatch.create({ data: { actorName: opts.actorName, databaseHost: opts.databaseHost, mode: "APPLY", status: "PLANNED", summary: { sourceDryRunBatchId: opts.sourceDryRunBatchId ?? null, approvedReviewIds },
    migrationBatchRecords: { create: rows.map((r) => ({ legacyProjectId: r.projectId, classification: r.classification, status: "PLANNED", snapshot: snapshotJson({ plannedRow: r }) })) } } });
  return { batchId: batch.id, planned: rows.length };
}

export async function applyLegacyBatch(db: PrismaClient, batchId: string): Promise<{ applied: number; skipped: { legacyProjectId: string; reason: string }[]; status: "APPLIED" | "PARTIAL" }> {
  const batch = await db.crmMigrationBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.mode !== "APPLY" || batch.status === "ROLLED_BACK") throw new Error("An active APPLY batch is required");
  let applied = 0;
  const skipped: { legacyProjectId: string; reason: string }[] = [];
  const records = await db.crmMigrationRecord.findMany({ where: { batchId, status: "PLANNED" }, orderBy: { legacyProjectId: "asc" } });
  for (const record of records) {
    const reason = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CrmMigrationBatch" WHERE id = ${batchId} FOR UPDATE`;
      const activeBatch = await tx.crmMigrationBatch.findUniqueOrThrow({ where: { id: batchId } });
      if (activeBatch.mode !== "APPLY" || activeBatch.status === "ROLLED_BACK") throw new Error("An active APPLY batch is required");
      await tx.$queryRaw`SELECT id FROM "CrmMigrationRecord" WHERE id = ${record.id} FOR UPDATE`;
      const current = await tx.crmMigrationRecord.findUniqueOrThrow({ where: { id: record.id } });
      if (current.status !== "PLANNED") return "RECORD_PROCESSED";
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${record.legacyProjectId} FOR UPDATE`;
      const skip = async (reason: string) => { await tx.crmMigrationRecord.update({ where: { id: record.id }, data: { status: "SKIPPED", snapshot: snapshotJson({ ...jsonObject(current.snapshot), skipReason: reason }) } }); return reason; };
      if (await tx.opportunity.findUnique({ where: { legacyProjectId: record.legacyProjectId } })) return skip("ALREADY_MIGRATED");
      const [row] = (await planLegacyMigration(tx, { projectIds: [record.legacyProjectId] })).rows;
      const planned = deserializeSnapshotRow<{ plannedRow?: LegacyPlanRow }>(current.snapshot).plannedRow;
      const approved = jsonObject(activeBatch.summary).approvedReviewIds;
      if (!row || row.classification !== record.classification || !["MIGRATE", "NEEDS_REVIEW"].includes(row.classification) || row.classification === "NEEDS_REVIEW" && (!Array.isArray(approved) || !approved.includes(row.projectId)) || planned && (planned.status !== row.status || JSON.stringify(planned.reasons) !== JSON.stringify(row.reasons))) return skip("STATE_CHANGED");
      const project = await tx.project.findUniqueOrThrow({ where: { id: row.projectId } }), opportunityId = randomUUID();
      const owner = { projectId: project.id };
      const [members, wishes, tasks, files, meetings, notifications, drive] = await Promise.all([
        tx.projectMember.findMany({ where: owner }), tx.projectWish.findMany({ where: owner }), tx.task.findMany({ where: owner, select: { id: true } }),
        tx.projectFile.findMany({ where: owner, select: { id: true } }), tx.meeting.findMany({ where: owner, select: { id: true } }), tx.notification.findMany({ where: owner, select: { id: true } }),
        tx.driveFolder.findMany({ where: { OR: [{ key: `project:${project.id}` }, { key: { startsWith: `project:${project.id}:` } }] }, select: { key: true, updatedAt: true } }),
      ]);
      const ids = (rows: { id: string }[]) => rows.map((r) => r.id), mapped = mapLegacyProjectToOpportunity(project, { opportunityId });
      const stageEventIds = [randomUUID(), ...(mapped.outcome ? [randomUUID()] : [])];
      const snapshot: Snapshot = { project, members, wishes, taskIds: ids(tasks), fileIds: ids(files), meetingIds: ids(meetings), notificationIds: ids(notifications), driveKeyPairs: legacyDriveKeyPairs(project.id, opportunityId, drive.map((r) => r.key)), driveFolders: drive, closedAtSource: legacyClosedAtSource(project), stageEventIds };
      await tx.crmMigrationRecord.update({ where: { id: record.id }, data: { snapshot: snapshotJson(snapshot) } });
      await tx.opportunity.create({ data: mapped });
      await tx.opportunityStageEvent.createMany({ data: stageEventIds.map((id, index) => ({ id, opportunityId, fromStage: index ? "BIDDING" : null, toStage: "BIDDING", outcome: index ? "LEGACY_UNCLASSIFIED" : null, actorName: LEGACY_IMPORT_ACTOR_NAME, note: "legacy import", occurredAt: index ? mapped.closedAt as Date : project.createdAt })) });
      if (members.length) await tx.opportunityMember.createMany({ data: members.map((m) => ({ opportunityId, userId: m.userId, createdAt: m.createdAt })) });
      const data = { projectId: null, opportunityId };
      await tx.task.updateMany({ where: owner, data }); await tx.projectFile.updateMany({ where: owner, data }); await tx.meeting.updateMany({ where: owner, data }); await tx.notification.updateMany({ where: owner, data });
      for (const pair of snapshot.driveKeyPairs) await tx.driveFolder.update({ where: { key: pair.from }, data: { key: pair.to, updatedAt: drive.find((r) => r.key === pair.from)!.updatedAt } });
      await tx.project.delete({ where: { id: project.id } });
      await tx.crmMigrationRecord.update({ where: { id: record.id }, data: { status: "APPLIED", opportunityId } });
      return null;
    }, { timeout: 30000 }).catch(async (error: unknown) => {
      // Only the legacyProjectId unique collision is an idempotent skip; other failures retain PLANNED for retry.
      const e = error as { code?: string; meta?: { target?: string[] } };
      if (e.code !== "P2002" || !e.meta?.target?.includes("legacyProjectId")) throw error;
      await db.crmMigrationRecord.update({ where: { id: record.id }, data: { status: "SKIPPED", snapshot: snapshotJson({ ...jsonObject(record.snapshot), skipReason: "ALREADY_MIGRATED" }) } });
      return "ALREADY_MIGRATED";
    });
    if (reason === null) applied++; else if (reason !== "RECORD_PROCESSED") skipped.push({ legacyProjectId: record.legacyProjectId, reason });
  }
  const skippedCount = await db.crmMigrationRecord.count({ where: { batchId, status: "SKIPPED" } });
  const status = skippedCount ? "PARTIAL" : "APPLIED";
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CrmMigrationBatch" WHERE id = ${batchId} FOR UPDATE`;
    const latest = await tx.crmMigrationBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (latest.status === "ROLLED_BACK") throw new Error("Batch was rolled back");
    await tx.crmMigrationBatch.update({ where: { id: batchId }, data: { status, finishedAt: new Date(), summary: snapshotJson({ ...jsonObject(latest.summary), applied, skipped }) } });
  });
  return { applied, skipped, status };
}

function readSnapshot(record: CrmMigrationRecord): Snapshot {
  const snapshot = deserializeSnapshotRow<Snapshot>(record.snapshot);
  if (!snapshot?.project || snapshot.project.id !== record.legacyProjectId || ![snapshot.members, snapshot.wishes, snapshot.taskIds, snapshot.fileIds, snapshot.meetingIds, snapshot.notificationIds, snapshot.driveKeyPairs, snapshot.stageEventIds].every(Array.isArray)) throw new Error(`Invalid migration snapshot: ${record.id}`);
  return snapshot;
}
export async function detectNewActivity(db: Db, record: CrmMigrationRecord): Promise<string[]> {
  const opportunityId = record.opportunityId;
  const opportunity = opportunityId ? await db.opportunity.findUnique({ where: { id: opportunityId } }) : null;
  if (!opportunity || !opportunityId) return ["OPPORTUNITY_MISSING"];
  const snapshot = readSnapshot(record), mapped = mapLegacyProjectToOpportunity(snapshot.project, { opportunityId });
  const reasons: string[] = [];
  const [events, tasks, files, meetings, touchpoints, project] = await Promise.all([
    db.opportunityStageEvent.count({ where: { opportunityId, id: { notIn: snapshot.stageEventIds } } }),
    db.task.count({ where: { opportunityId, id: { notIn: snapshot.taskIds } } }),
    db.projectFile.count({ where: { opportunityId, id: { notIn: snapshot.fileIds } } }),
    db.meeting.count({ where: { opportunityId, id: { notIn: snapshot.meetingIds } } }),
    db.touchpoint.count({ where: { opportunityId } }), db.project.count({ where: { sourceOpportunityId: opportunityId } }),
  ]);
  if (events) reasons.push("NEW_STAGE_EVENT");
  if (opportunity.stage !== mapped.stage || opportunity.outcome !== mapped.outcome || opportunity.version !== 0) reasons.push("STAGE_OR_OUTCOME_CHANGED");
  if (tasks) reasons.push("NEW_TASK");
  if (files) reasons.push("NEW_FILE");
  if (meetings) reasons.push("NEW_MEETING");
  if (touchpoints) reasons.push("NEW_TOUCHPOINT");
  if (project) reasons.push("WON_PROJECT_EXISTS");
  return reasons;
}
type RollbackResult = { ok: true; restored: number; rollbackBatchId: string } | { blocked: { legacyProjectId: string; opportunityId: string | null; reasons: string[] }[] };
export async function rollbackLegacyBatch(db: PrismaClient, batchId: string, operator: Operator): Promise<RollbackResult> {
  // Keep the preflight locks until the final delete. One transaction for the whole batch
  // also prevents a later record failure from leaving earlier Projects partly restored.
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CrmMigrationBatch" WHERE id = ${batchId} FOR UPDATE`;
    const batch = await tx.crmMigrationBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.mode !== "APPLY") throw new Error("Only APPLY batches can be rolled back");
    if (batch.status === "ROLLED_BACK") {
      const rollbackBatchId = jsonObject(batch.summary).rollbackBatchId;
      if (typeof rollbackBatchId !== "string") throw new Error("Rollback audit batch is missing");
      return { ok: true, restored: 0, rollbackBatchId };
    }
    const records = await tx.crmMigrationRecord.findMany({ where: { batchId, status: "APPLIED" }, orderBy: { opportunityId: "asc" } });
    const blocked: Extract<RollbackResult, { blocked: unknown }>['blocked'] = [];
    for (const record of records) {
      await tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${record.opportunityId} FOR UPDATE`;
      const reasons = await detectNewActivity(tx, record);
      if (reasons.length) blocked.push({ legacyProjectId: record.legacyProjectId, opportunityId: record.opportunityId, reasons });
    }
    if (blocked.length) return { blocked };
    for (const record of records) {
      const snapshot = readSnapshot(record), projectId = snapshot.project.id;
      await tx.project.create({ data: snapshot.project });
      if (snapshot.members.length) await tx.projectMember.createMany({ data: snapshot.members });
      if (snapshot.wishes.length) await tx.projectWish.createMany({ data: snapshot.wishes });
      const data = { projectId, opportunityId: null };
      await tx.task.updateMany({ where: { id: { in: snapshot.taskIds }, opportunityId: record.opportunityId }, data });
      await tx.projectFile.updateMany({ where: { id: { in: snapshot.fileIds }, opportunityId: record.opportunityId }, data });
      await tx.meeting.updateMany({ where: { id: { in: snapshot.meetingIds }, opportunityId: record.opportunityId }, data });
      await tx.notification.updateMany({ where: { id: { in: snapshot.notificationIds }, opportunityId: record.opportunityId }, data });
      for (const pair of snapshot.driveKeyPairs) await tx.driveFolder.update({ where: { key: pair.to }, data: { key: pair.from, updatedAt: snapshot.driveFolders.find((r) => r.key === pair.from)!.updatedAt } });
      await tx.opportunity.delete({ where: { id: record.opportunityId! } });
      await tx.crmMigrationRecord.update({ where: { id: record.id }, data: { status: "ROLLED_BACK" } });
    }
    const rollback = await tx.crmMigrationBatch.create({ data: { ...operator, mode: "ROLLBACK", status: "ROLLED_BACK", finishedAt: new Date(), summary: { rolledBackBatchId: batchId } } });
    await tx.crmMigrationBatch.update({ where: { id: batchId }, data: { status: "ROLLED_BACK", finishedAt: new Date(), summary: snapshotJson({ ...jsonObject(batch.summary), rollbackBatchId: rollback.id }) } });
    return { ok: true, restored: records.length, rollbackBatchId: rollback.id };
  }, { timeout: 30000 });
}
