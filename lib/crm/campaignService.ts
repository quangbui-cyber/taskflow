import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { vnDateKey, vnDayStartFromKey } from "./dates";
import { canManageCampaign, crmWorkableUserIds, draftFromRow, loadCampaignCandidates, loadCampaignPics, previewCampaign } from "./campaignData";
import {
  CAMPAIGN_CANCELLED, CAMPAIGN_MERGED_DUPLICATE, CAMPAIGN_STOPPED_OPPORTUNITY, SUGGESTED_CAMPAIGN_TEMPLATES, campaignEndKey, parseCampaignOptions, parseCampaignSteps, validateCampaignDraft,
} from "./campaignPlan";
import type { CrmActor } from "./policy";
import { getCrmSettings } from "./settings";

type Actor = CrmActor & { name: string };
type Tx = Prisma.TransactionClient;
type Failure = { error: string; fieldErrors?: Record<string, string> };
type Notice = { type: "CRM_TASK_ASSIGNED"; message: string };
export type CampaignEffects = { notify: (ids: string[], data: Notice) => Promise<void> };
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const STALE = "Dữ liệu vừa được người khác cập nhật. Tải lại trang để xem bản mới.";
const INVALID = "Thông tin chiến dịch không hợp lệ.";
const NOT_FOUND = "Không tìm thấy chiến dịch.";
const validId = (v: unknown): v is string => typeof v === "string" && !!v && v.length <= 64;
const validVersion = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

async function lockCampaign(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "CareCampaign" WHERE id = ${id} FOR UPDATE`;
  return tx.careCampaign.findUnique({ where: { id } });
}

/** Create or update a DRAFT. A team is required for non-Admins and must be one they manage. */
export async function saveCampaignDraft(db: PrismaClient, actor: Actor, input: { id?: string | null; expectedVersion?: number; draft: unknown }): Promise<{ ok: true; id: string; version: number } | Failure> {
  const parsed = validateCampaignDraft(input.draft);
  if ("errors" in parsed) return { error: Object.values(parsed.errors)[0], fieldErrors: parsed.errors };
  const draft = parsed.value;
  if (!canManageCampaign(actor, draft.teamId)) return { error: actor.role === "ADMIN" ? DENIED : "Chọn team bạn quản lý." };
  if (draft.teamId && !await db.salesTeam.findUnique({ where: { id: draft.teamId }, select: { id: true } })) return { error: INVALID };
  const data = {
    name: draft.name, goal: draft.goal, targetOpportunities: draft.targetOpportunities, startDate: vnDayStartFromKey(draft.startKey), endDate: draft.endKey ? vnDayStartFromKey(draft.endKey) : null,
    steps: json(draft.steps), options: json(draft.options), filter: json(draft.filter), assignments: json(draft.assignments), teamId: draft.teamId,
  };
  if (!input.id) {
    const row = await db.careCampaign.create({ data: { ...data, status: "DRAFT", createdById: actor.id } });
    return { ok: true, id: row.id, version: row.version };
  }
  if (!validId(input.id) || !validVersion(input.expectedVersion)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const row = await lockCampaign(tx, input.id!);
    if (!row) return { error: NOT_FOUND };
    if (!canManageCampaign(actor, row.teamId)) return { error: DENIED };
    if (row.status !== "DRAFT") return { error: "Chiến dịch đã chạy, không sửa bản nháp được nữa." };
    if (row.version !== input.expectedVersion) return { error: STALE };
    await tx.careCampaign.update({ where: { id: row.id }, data: { ...data, version: { increment: 1 } } });
    return { ok: true as const, id: row.id, version: row.version + 1 };
  });
}

export async function deleteCampaignDraft(db: PrismaClient, actor: Actor, input: { id: string; expectedVersion: number }): Promise<{ ok: true } | Failure> {
  if (!validId(input.id) || !validVersion(input.expectedVersion)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const row = await lockCampaign(tx, input.id);
    if (!row) return { error: NOT_FOUND };
    if (!canManageCampaign(actor, row.teamId)) return { error: DENIED };
    if (row.status !== "DRAFT") return { error: "Chỉ xóa được bản nháp." };
    if (row.version !== input.expectedVersion) return { error: STALE };
    await tx.careCampaign.delete({ where: { id: row.id } });
    return { ok: true as const };
  });
}

export type LaunchResult = { ok: true; alreadyLaunched: boolean; targets: number; tasks: number; excluded: number } | Failure;
/**
 * One transaction: lock the campaign row, re-select clients on the server, create one target per client and one CRM task per
 * client x step. A repeated or concurrent launch waits on the row lock, sees ACTIVE and creates nothing.
 */
export async function launchCampaign(db: PrismaClient, actor: Actor, input: { id: string; expectedVersion: number }, effects?: CampaignEffects, now = new Date()): Promise<LaunchResult> {
  if (!validId(input.id) || !validVersion(input.expectedVersion)) return { error: INVALID };
  const result = await db.$transaction(async (tx): Promise<(LaunchResult & { notices?: { userId: string; count: number }[]; name?: string })> => {
    const row = await lockCampaign(tx, input.id);
    if (!row) return { error: NOT_FOUND };
    if (!canManageCampaign(actor, row.teamId)) return { error: DENIED };
    if (row.status !== "DRAFT") {
      if (row.status === "CANCELLED") return { error: "Chiến dịch đã hủy." };
      const [targets, tasks] = await Promise.all([tx.careCampaignTarget.count({ where: { campaignId: row.id } }), tx.careCampaignTask.count({ where: { target: { campaignId: row.id } } })]);
      return { ok: true, alreadyLaunched: true, targets, tasks, excluded: 0 };
    }
    if (row.version !== input.expectedVersion) return { error: STALE };
    const draft = draftFromRow(row);
    if (!draft) return { error: INVALID };
    const settings = await getCrmSettings(tx);
    const preview = await previewCampaign(tx, draft, now, { settings, candidates: await loadCampaignCandidates(tx, settings, now), pics: await loadCampaignPics(tx) });
    if (preview.blockers.length) return { error: preview.blockers[0] };
    // Re-check CRM access of every assignee inside the transaction (crm54).
    const allowed = await crmWorkableUserIds(tx, [...new Set(preview.selection.targets.map((t) => t.picUserId))]);
    const targets = preview.selection.targets.filter((t) => allowed.has(t.picUserId));
    if (!targets.length) return { error: "Chọn ít nhất một khách có PIC được mở CRM." };
    const targetRows = targets.map((t) => ({ id: randomUUID(), campaignId: row.id, clientId: t.clientId, picAccountId: t.picAccountId }));
    await tx.careCampaignTarget.createMany({ data: targetRows });
    const taskRows: Prisma.TaskCreateManyInput[] = [];
    const links: Prisma.CareCampaignTaskCreateManyInput[] = [];
    targets.forEach((target, i) => {
      for (const step of preview.scheduled) {
        const taskId = randomUUID();
        taskRows.push({ id: taskId, title: step.title, description: `Chiến dịch ${row.name} · bước ${step.stepIndex + 1}/${preview.scheduled.length}`, status: "TODO", crmKind: "CAMPAIGN", dueDate: step.dueDate, assigneeId: target.picUserId, creatorId: actor.id, clientId: target.clientId });
        links.push({ targetId: targetRows[i].id, stepIndex: step.stepIndex, taskId });
      }
    });
    await tx.task.createMany({ data: taskRows });
    await tx.careCampaignTask.createMany({ data: links });
    await tx.careCampaign.update({ where: { id: row.id }, data: {
      status: "ACTIVE", launchedAt: now, version: { increment: 1 },
      endDate: row.endDate ?? vnDayStartFromKey(campaignEndKey(draft.startKey, draft.steps)),
    } });
    const perUser = new Map<string, number>();
    for (const t of taskRows) perUser.set(t.assigneeId!, (perUser.get(t.assigneeId!) ?? 0) + 1);
    return { ok: true, alreadyLaunched: false, targets: targets.length, tasks: taskRows.length, excluded: preview.selection.excluded.length + preview.selection.targets.length - targets.length, notices: [...perUser].map(([userId, count]) => ({ userId, count })), name: row.name };
  }, { timeout: 60_000, maxWait: 15_000 });
  if (!("ok" in result)) return result;
  const { notices, name, ...out } = result;
  for (const notice of notices ?? []) {
    if (notice.userId === actor.id) continue;
    try {
      const notify = effects?.notify ?? (await import("../notify")).notify;
      await notify([notice.userId], { type: "CRM_TASK_ASSIGNED", message: `Chiến dịch ${name}: bạn có ${notice.count} việc chăm sóc khách.` });
    } catch { console.warn("CRM campaign notification could not be delivered."); }
  }
  return out;
}

async function closeOpenCampaignTasks(tx: Tx, where: Prisma.CareCampaignTaskWhereInput, reason: string): Promise<number> {
  const links = await tx.careCampaignTask.findMany({ where: { ...where, task: { status: OPEN_TASK_STATUS_FILTER } }, select: { taskId: true } });
  if (!links.length) return 0;
  return (await tx.task.updateMany({ where: { id: { in: links.map((l) => l.taskId) }, status: OPEN_TASK_STATUS_FILTER }, data: { status: "CANCELLED", closedReason: reason } })).count;
}

type Transition = "PAUSE" | "RESUME" | "CANCEL" | "FINISH";
/** Pause keeps created tasks and stops the cadence pause; cancel closes every open campaign task. */
export async function changeCampaignStatus(db: PrismaClient, actor: Actor, input: { id: string; expectedVersion: number; action: Transition }, now = new Date()): Promise<{ ok: true; version: number; cancelledTasks: number } | Failure> {
  if (!validId(input.id) || !validVersion(input.expectedVersion) || !["PAUSE", "RESUME", "CANCEL", "FINISH"].includes(input.action)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const row = await lockCampaign(tx, input.id);
    if (!row) return { error: NOT_FOUND };
    if (!canManageCampaign(actor, row.teamId)) return { error: DENIED };
    if (row.version !== input.expectedVersion) return { error: STALE };
    const allowed: Record<Transition, string[]> = { PAUSE: ["ACTIVE"], RESUME: ["PAUSED"], CANCEL: ["ACTIVE", "PAUSED"], FINISH: ["ACTIVE", "PAUSED"] };
    if (!allowed[input.action].includes(row.status)) return { error: "Trạng thái chiến dịch không cho phép thao tác này." };
    let cancelledTasks = 0;
    if (input.action === "FINISH" && await tx.careCampaignTask.count({ where: { target: { campaignId: row.id }, task: { status: OPEN_TASK_STATUS_FILTER } } })) return { error: "Còn việc chưa xong. Hủy chiến dịch nếu muốn dừng các việc còn lại." };
    if (input.action === "CANCEL") {
      cancelledTasks = await closeOpenCampaignTasks(tx, { target: { campaignId: row.id } }, CAMPAIGN_CANCELLED);
      await tx.careCampaignTarget.updateMany({ where: { campaignId: row.id, status: "ACTIVE" }, data: { status: "STOPPED", stoppedReason: CAMPAIGN_CANCELLED, stoppedAt: now } });
    }
    if (input.action === "FINISH") await tx.careCampaignTarget.updateMany({ where: { campaignId: row.id, status: "ACTIVE" }, data: { status: "DONE" } });
    const status = { PAUSE: "PAUSED", RESUME: "ACTIVE", CANCEL: "CANCELLED", FINISH: "DONE" }[input.action];
    await tx.careCampaign.update({ where: { id: row.id }, data: {
      status, version: { increment: 1 }, pausedAt: input.action === "PAUSE" ? now : input.action === "RESUME" ? null : row.pausedAt,
      closedAt: input.action === "CANCEL" || input.action === "FINISH" ? now : null,
    } });
    return { ok: true as const, version: row.version + 1, cancelledTasks };
  });
}

/**
 * Called inside openOpportunityTx (client row already locked). Stops the client's active targets in running or paused campaigns
 * that have stopOnOpportunity and cancels their open steps with a stated reason.
 */
export async function stopCampaignTargetsOnOpportunity(tx: Tx, clientId: string, now = new Date()): Promise<number> {
  const targets = await tx.careCampaignTarget.findMany({
    where: { clientId, status: "ACTIVE", campaign: { status: { in: ["ACTIVE", "PAUSED"] }, launchedAt: { lte: now } } },
    select: { id: true, campaign: { select: { options: true, endDate: true } } },
  });
  const ids = targets.filter((t) => {
    if (!parseCampaignOptions(t.campaign.options)?.stopOnOpportunity) return false;
    return !t.campaign.endDate || vnDateKey(now) <= vnDateKey(t.campaign.endDate);
  }).map((t) => t.id);
  if (!ids.length) return 0;
  await tx.careCampaignTarget.updateMany({ where: { id: { in: ids }, status: "ACTIVE" }, data: { status: "STOPPED", stoppedReason: CAMPAIGN_STOPPED_OPPORTUNITY, stoppedAt: now } });
  return closeOpenCampaignTasks(tx, { targetId: { in: ids } }, CAMPAIGN_STOPPED_OPPORTUNITY);
}

/** A touchpoint that completes a campaign task feeds the campaign funnel. Returns true when the task belongs to a campaign. */
export async function linkCampaignTouchpoint(tx: Tx, taskId: string, touchpointId: string): Promise<boolean> {
  return (await tx.careCampaignTask.updateMany({ where: { taskId }, data: { touchpointId } })).count > 0;
}

/** Cadence pause (crm52 option): an open task of an ACTIVE campaign with pauseCadence on, for this client. */
export async function cadencePausedByCampaign(tx: Tx, clientId: string): Promise<boolean> {
  const links = await tx.careCampaignTask.findMany({
    where: { task: { clientId, status: OPEN_TASK_STATUS_FILTER }, target: { status: "ACTIVE", campaign: { status: "ACTIVE" } } },
    select: { target: { select: { campaign: { select: { options: true } } } } }, take: 20,
  });
  return links.some((l) => parseCampaignOptions(l.target.campaign.options)?.pauseCadence);
}

/** PIC change mid-campaign: open campaign tasks follow the new PIC when that person may use CRM; otherwise they stay as they are. */
export async function reassignCampaignOnPicChange(tx: Tx, clientId: string, picAccountId: string): Promise<number> {
  const targets = await tx.careCampaignTarget.findMany({ where: { clientId, status: "ACTIVE", campaign: { status: { in: ["ACTIVE", "PAUSED"] } } }, select: { id: true } });
  if (!targets.length) return 0;
  const account = await tx.account.findUnique({ where: { id: picAccountId }, select: { userId: true } });
  if (!account?.userId || !(await crmWorkableUserIds(tx, [account.userId])).has(account.userId)) return 0;
  const ids = targets.map((t) => t.id);
  await tx.careCampaignTarget.updateMany({ where: { id: { in: ids } }, data: { picAccountId } });
  const links = await tx.careCampaignTask.findMany({ where: { targetId: { in: ids }, task: { status: OPEN_TASK_STATUS_FILTER } }, select: { taskId: true } });
  return (await tx.task.updateMany({ where: { id: { in: links.map((l) => l.taskId) } }, data: { assigneeId: account.userId } })).count;
}

/**
 * Client merge: source targets move to the kept client. If the kept client is in the same campaign, steps it lacks move over;
 * duplicate steps are cancelled with a stated reason and the source target is removed.
 */
export async function moveCampaignTargetsOnMerge(tx: Tx, sourceClientId: string, targetClientId: string): Promise<{ moved: number; merged: number }> {
  const sourceTargets = await tx.careCampaignTarget.findMany({ where: { clientId: sourceClientId }, include: { tasks: true } });
  let moved = 0, merged = 0;
  for (const source of sourceTargets) {
    const kept = await tx.careCampaignTarget.findUnique({ where: { campaignId_clientId: { campaignId: source.campaignId, clientId: targetClientId } }, include: { tasks: true } });
    if (!kept) { await tx.careCampaignTarget.update({ where: { id: source.id }, data: { clientId: targetClientId } }); moved++; continue; }
    const keptSteps = new Set(kept.tasks.map((t) => t.stepIndex));
    for (const link of source.tasks) {
      if (!keptSteps.has(link.stepIndex)) { await tx.careCampaignTask.update({ where: { id: link.id }, data: { targetId: kept.id } }); keptSteps.add(link.stepIndex); continue; }
      await tx.task.updateMany({ where: { id: link.taskId, status: OPEN_TASK_STATUS_FILTER }, data: { status: "CANCELLED", closedReason: CAMPAIGN_MERGED_DUPLICATE } });
      await tx.careCampaignTask.delete({ where: { id: link.id } });
    }
    await tx.careCampaignTarget.delete({ where: { id: source.id } });
    merged++;
  }
  return { moved, merged };
}

/** Admin template catalog: unique name, disable instead of delete, history in CrmSettingChange. */
export async function saveCampaignTemplate(db: PrismaClient, actor: Actor, input: { id?: string; name: string; description: string | null; steps: unknown; active: boolean; order: number }): Promise<{ id: string } | Failure> {
  if (actor.role !== "ADMIN") return { error: DENIED };
  const steps = parseCampaignSteps(input.steps);
  const name = typeof input.name === "string" ? input.name.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  const description = typeof input.description === "string" ? input.description.trim() || null : null;
  if (!name || name.length > 80 || (description && description.length > 200) || !steps?.length || typeof input.active !== "boolean" || !Number.isSafeInteger(input.order) || (input.id !== undefined && !validId(input.id))) return { error: INVALID };
  try {
    return await db.$transaction(async (tx) => {
      const old = input.id ? await tx.careCampaignTemplate.findUnique({ where: { id: input.id } }) : null;
      if (input.id && !old) return { error: INVALID };
      const data = { name, description, steps: json(steps), active: input.active, order: input.order };
      const row = old ? await tx.careCampaignTemplate.update({ where: { id: old.id }, data }) : await tx.careCampaignTemplate.create({ data });
      await tx.crmSettingChange.create({ data: { key: `campaignTemplate.${row.id}`, oldValue: old ? json(old) : Prisma.JsonNull, newValue: json(row), userId: actor.id, userName: actor.name } });
      return { id: row.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "Tên mẫu đã tồn tại." };
    throw error;
  }
}

/** "Thêm mẫu gợi ý": creates the four suggested templates that do not exist yet. Nothing is seeded otherwise. */
export async function addSuggestedCampaignTemplates(db: PrismaClient, actor: Actor): Promise<{ ok: true; added: number } | Failure> {
  if (actor.role !== "ADMIN") return { error: DENIED };
  let added = 0;
  const count = await db.careCampaignTemplate.count();
  for (const [i, template] of SUGGESTED_CAMPAIGN_TEMPLATES.entries()) {
    if (await db.careCampaignTemplate.findUnique({ where: { name: template.name }, select: { id: true } })) continue;
    const saved = await saveCampaignTemplate(db, actor, { name: template.name, description: template.description, steps: template.steps, active: true, order: count + i });
    if ("id" in saved) added++;
  }
  return { ok: true, added };
}
