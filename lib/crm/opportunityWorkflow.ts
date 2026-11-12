import type { Prisma, PrismaClient } from "@prisma/client";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { loadClientResource, loadOpportunityResource } from "./actor";
import { crmCan, type CrmActor } from "./policy";
import { OPPORTUNITY_OUTCOMES, OPPORTUNITY_STAGES } from "./labels";
import { canAdvance, canClose, defaultOpportunityName, validateOpenOpportunityInput, validOpportunityMoney } from "./opportunityStage";
import { crmDeniedForUser } from "./access";

type Actor = CrmActor & { name: string };
type WorkflowError = { error: string; fieldErrors?: Record<string, string> };
type OpenResult = { ok: true; opportunityId: string; version: number } | WorkflowError;
type AdvanceResult = { ok: true; closedReminders: number; version: number } | WorkflowError;
type CloseResult = { ok: true; cancelledTasks: number; version: number } | WorkflowError;
type StageNotice = { type: "CRM_STAGE"; message: string; opportunityId: string; clientId: string };
type Effects = { notify: (ids: string[], data: StageNotice) => Promise<void> };
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const STALE = "Dữ liệu vừa được người khác cập nhật. Tải lại trang để xem bản mới.";
const CLOSED = "Cơ hội đã kết thúc không mở lại được.";
const INVALID = "Thông tin Cơ hội không hợp lệ.";
export const CLIENT_ARCHIVED = "Khách đang lưu trữ. Khôi phục khách trước khi mở Cơ hội mới.";
const validId = (value: unknown): value is string => typeof value === "string" && !!value && value.length <= 64;
const validVersion = (value: number) => Number.isSafeInteger(value) && value >= 0;
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const validText = (value: unknown, limit = 4000) => value === null || value === undefined || (typeof value === "string" && value.trim().length <= limit);
const text = (value: string | null | undefined) => value?.trim() || null;

export async function lockOpportunity(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${id} FOR UPDATE`;
}

export async function openOpportunityTx(tx: Prisma.TransactionClient, actor: Actor, raw: unknown): Promise<OpenResult> {
  const parsed = validateOpenOpportunityInput(raw);
  if (!("ok" in parsed)) return { error: Object.values(parsed.errors)[0], fieldErrors: parsed.errors };
  const input = parsed.value;
  await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${input.clientId} FOR UPDATE`;
  const resource = await loadClientResource(tx, input.clientId);
  if (!resource || !crmCan(actor, "EDIT", resource)) return { error: DENIED };
  const client = await tx.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { picAccountId: true, responsibleTeamId: true, archivedAt: true } });
  if (client.archivedAt) return { error: CLIENT_ARCHIVED };
  const picAccountId = input.picAccountId ?? client.picAccountId;
  const [program, pic, unit] = await Promise.all([
    tx.programType.findUnique({ where: { code: input.programTypeCode }, select: { label: true, active: true } }),
    picAccountId ? tx.account.findUnique({ where: { id: picAccountId }, select: { userId: true, teamId: true, user: { select: { isActive: true, deletedAt: true } } } }) : null,
    input.buyingUnitId ? tx.buyingUnit.findFirst({ where: { id: input.buyingUnitId, clientId: input.clientId, active: true }, select: { id: true } }) : null,
  ]);
  if (!program?.active) return { error: "Chọn loại chương trình đang dùng." };
  if ((picAccountId && !pic) || (pic?.user && (!pic.user.isActive || pic.user.deletedAt)) || (input.buyingUnitId && !unit)) return { error: INVALID };
  const teamId = input.responsibleTeamId ?? client.responsibleTeamId ?? pic?.teamId ?? null;
  if (teamId && !await tx.salesTeam.findUnique({ where: { id: teamId }, select: { id: true } })) return { error: INVALID };
  if (input.expectedEventId) {
    await tx.$queryRaw`SELECT id FROM "ExpectedEvent" WHERE id = ${input.expectedEventId} FOR UPDATE`;
    const event = await tx.expectedEvent.findUnique({ where: { id: input.expectedEventId }, select: { clientId: true, status: true, opportunity: { select: { id: true } } } });
    if (!event || event.clientId !== input.clientId || event.status !== "ACTIVE" || event.opportunity) return { error: "Sự kiện dự kiến không còn phù hợp để gắn Cơ hội." };
  }
  const opportunity = await tx.opportunity.create({ data: {
    clientId: input.clientId, buyingUnitId: input.buyingUnitId, programTypeCode: input.programTypeCode,
    name: input.name ?? defaultOpportunityName(program.label, input.expectedYear), expectedYear: input.expectedYear, expectedMonth: input.expectedMonth, expectedQuarter: input.expectedQuarter,
    source: input.source, demandSignal: input.demandSignal, budgetMin: input.budgetMin, budgetMax: input.budgetMax,
    picAccountId, responsibleTeamId: teamId, expectedEventId: input.expectedEventId, stage: "CARE", createdById: actor.id,
  } });
  const userIds = [...new Set([actor.id, pic?.userId].filter((id): id is string => !!id))];
  await tx.opportunityMember.createMany({ data: userIds.map((userId) => ({ opportunityId: opportunity.id, userId })) });
  await tx.opportunityStageEvent.create({ data: { opportunityId: opportunity.id, fromStage: null, toStage: "CARE", actorId: actor.id, actorName: actor.name, note: "Mở Cơ hội ở Chăm sóc" } });
  return { ok: true, opportunityId: opportunity.id, version: opportunity.version };
}

export async function openOpportunity(db: PrismaClient, actor: Actor, input: unknown): Promise<OpenResult> {
  return db.$transaction((tx) => openOpportunityTx(tx, actor, input));
}

async function closeLinkedReminders(tx: Prisma.TransactionClient, expectedEventId: string, stepReason: string, taskReason: string) {
  await tx.$queryRaw`SELECT id FROM "ExpectedEvent" WHERE id = ${expectedEventId} FOR UPDATE`;
  const steps = await tx.reminderStep.findMany({ where: { expectedEventId, status: { in: ["PLANNED", "OPEN"] } }, select: { id: true, taskId: true } });
  if (!steps.length) return 0;
  const closed = await tx.reminderStep.updateMany({ where: { id: { in: steps.map((step) => step.id) }, status: { in: ["PLANNED", "OPEN"] } }, data: { status: "CLOSED", closedReason: stepReason } });
  const taskIds = [...new Set(steps.map((step) => step.taskId).filter((id): id is string => !!id))];
  if (taskIds.length) {
    // A consolidated reminder task may still carry another event's active step.
    const remaining = await tx.reminderStep.findMany({ where: { taskId: { in: taskIds }, status: { in: ["PLANNED", "OPEN"] } }, select: { taskId: true } });
    const shared = new Set(remaining.map((step) => step.taskId));
    await tx.task.updateMany({ where: { id: { in: taskIds.filter((id) => !shared.has(id)) }, status: OPEN_TASK_STATUS_FILTER }, data: { status: "CANCELLED", closedReason: taskReason } });
  }
  return closed.count;
}

export type AdvanceOpportunityInput = {
  opportunityId: string;
  expectedVersion: number;
  to: "BRIEF" | "BIDDING";
  briefReceivedAt?: Date;
  proposalDueAt?: Date | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  briefSummary?: string | null;
  winStrategy?: string | null;
  proposalPlannedAt?: Date | null;
};
export async function advanceStage(db: PrismaClient, actor: Actor, input: AdvanceOpportunityInput, effects?: Effects): Promise<AdvanceResult> {
  if (!validId(input.opportunityId) || !validVersion(input.expectedVersion) || !["BRIEF", "BIDDING"].includes(input.to)) return { error: INVALID };
  if (!validText(input.briefSummary) || !validText(input.winStrategy) || !validOpportunityMoney(input.budgetMin) || !validOpportunityMoney(input.budgetMax)) return { error: INVALID };
  if ((input.proposalDueAt != null && !validDate(input.proposalDueAt)) || (input.proposalPlannedAt != null && !validDate(input.proposalPlannedAt))) return { error: INVALID };
  const result = await db.$transaction<(AdvanceResult & { name?: string; clientId?: string; memberIds?: string[] })>(async (tx) => {
    await lockOpportunity(tx, input.opportunityId);
    const opportunity = await tx.opportunity.findUnique({ where: { id: input.opportunityId }, include: { opportunityMembers: { select: { userId: true } } } });
    if (!opportunity) return { error: DENIED };
    if (opportunity.outcome !== null) return { error: CLOSED };
    const resource = await loadOpportunityResource(tx, opportunity.id);
    if (!resource || !crmCan(actor, "EDIT", resource)) return { error: DENIED };
    if (opportunity.version !== input.expectedVersion) return { error: STALE };
    if (!canAdvance(opportunity, input.to)) return { error: "Chỉ chuyển sang stage kế tiếp." };
    if (input.to === "BRIEF" && !validDate(input.briefReceivedAt)) return { error: "Nhập ngày nhận Brief." };
    const min = input.budgetMin === undefined ? opportunity.budgetMin === null ? null : Number(opportunity.budgetMin) : input.budgetMin;
    const max = input.budgetMax === undefined ? opportunity.budgetMax === null ? null : Number(opportunity.budgetMax) : input.budgetMax;
    if (min !== null && max !== null && min > max) return { error: "Ngân sách dự kiến không hợp lệ." };
    const data: Prisma.OpportunityUpdateManyMutationInput = { stage: input.to, version: { increment: 1 } };
    if (input.to === "BRIEF") {
      data.briefReceivedAt = input.briefReceivedAt;
      if (input.proposalDueAt !== undefined) data.proposalDueAt = input.proposalDueAt;
      if (input.budgetMin !== undefined) data.budgetMin = input.budgetMin;
      if (input.budgetMax !== undefined) data.budgetMax = input.budgetMax;
      if (input.briefSummary !== undefined) data.briefSummary = text(input.briefSummary);
    } else {
      if (input.winStrategy !== undefined) data.winStrategy = text(input.winStrategy);
      if (input.proposalPlannedAt !== undefined) data.proposalPlannedAt = input.proposalPlannedAt;
    }
    const changed = await tx.opportunity.updateMany({ where: { id: opportunity.id, version: input.expectedVersion, outcome: null }, data });
    if (changed.count !== 1) return { error: STALE };
    let closedReminders = 0;
    if (input.to === "BRIEF" && opportunity.expectedEventId) {
      closedReminders = await closeLinkedReminders(tx, opportunity.expectedEventId, "BRIEF_RECEIVED", "Đã nhận Brief");
      await tx.expectedEvent.update({ where: { id: opportunity.expectedEventId }, data: { status: "BRIEF_RECEIVED" } });
    }
    await tx.opportunityStageEvent.create({ data: { opportunityId: opportunity.id, fromStage: opportunity.stage, toStage: input.to, actorId: actor.id, actorName: actor.name } });
    return { ok: true, closedReminders, version: input.expectedVersion + 1, name: opportunity.name, clientId: opportunity.clientId, memberIds: opportunity.opportunityMembers.map((member) => member.userId) };
  });
  if (!("ok" in result)) return result;
  if (result.memberIds?.length && result.clientId) {
    try {
      const notify = effects?.notify ?? (await import("../notify")).notify;
      const label = OPPORTUNITY_STAGES.find((stage) => stage.key === input.to)!.label;
      await notify(result.memberIds, { type: "CRM_STAGE", message: `Cơ hội ${result.name} chuyển sang ${label}.`, clientId: result.clientId, opportunityId: input.opportunityId });
    } catch { console.warn("CRM stage notification could not be delivered."); }
  }
  return { ok: true, closedReminders: result.closedReminders, version: result.version };
}

export type CloseOpportunityInput = {
  opportunityId: string;
  expectedVersion: number;
  outcome: string;
  reasonId: string;
  note?: string | null;
  lessons?: string | null;
  followUp?: { title: string; assigneeId: string; dueDate: Date } | null;
  /** Optional agency that won the bid; only for LOST_COMPETITIVE. */
  winnerCompetitorId?: string | null;
};
export async function closeOpportunity(db: PrismaClient, actor: Actor, input: CloseOpportunityInput): Promise<CloseResult> {
  if (!validId(input.opportunityId) || !validVersion(input.expectedVersion) || !["LOST_COMPETITIVE", "CUSTOMER_CANCELLED", "CS_DECLINED"].includes(input.outcome) || !validText(input.note) || !validText(input.lessons)) return { error: INVALID };
  if (!validId(input.reasonId)) return { error: "Chọn lý do." };
  if (input.winnerCompetitorId != null && (!validId(input.winnerCompetitorId) || input.outcome !== "LOST_COMPETITIVE")) return { error: "Chỉ chọn agency thắng khi thua cạnh tranh." };
  if (input.followUp && (typeof input.followUp.title !== "string" || !input.followUp.title.trim() || !validText(input.followUp.title, 500) || !validId(input.followUp.assigneeId) || !validDate(input.followUp.dueDate))) return { error: "Nhập đủ việc, người làm và hạn tiếp cận lại." };
  return db.$transaction(async (tx) => {
    await lockOpportunity(tx, input.opportunityId);
    const opportunity = await tx.opportunity.findUnique({ where: { id: input.opportunityId } });
    if (!opportunity) return { error: DENIED };
    if (opportunity.outcome !== null) return { error: CLOSED };
    const resource = await loadOpportunityResource(tx, opportunity.id);
    if (!resource || !crmCan(actor, "CLOSE_OPPORTUNITY", resource)) return { error: DENIED };
    if (opportunity.version !== input.expectedVersion) return { error: STALE };
    if (!canClose(opportunity, input.outcome)) return { error: "Chỉ ghi Thắng hoặc Thua cạnh tranh từ Bidding." };
    const group = input.outcome === "LOST_COMPETITIVE" ? "LOST" : input.outcome === "CUSTOMER_CANCELLED" ? "CANCELLED" : "DECLINED";
    const reason = await tx.crmReason.findFirst({ where: { id: input.reasonId, group, active: true } });
    if (!reason) return { error: "Chọn lý do." };
    if (reason.requiresNote && !text(input.note)) return { error: `Ghi chú cho lý do ${reason.label}.` };
    if (input.followUp && !await tx.user.findFirst({ where: { id: input.followUp.assigneeId, isActive: true, deletedAt: null }, select: { id: true } })) return { error: "Chọn người làm đang hoạt động." };
    if (input.followUp && await crmDeniedForUser(tx, { id: input.followUp.assigneeId })) return { error: "Người này chưa được mở CRM." };
    if (input.winnerCompetitorId && !await tx.competitor.findFirst({ where: { id: input.winnerCompetitorId, active: true }, select: { id: true } })) return { error: "Chọn agency đang dùng." };
    const changed = await tx.opportunity.updateMany({ where: { id: opportunity.id, version: input.expectedVersion, outcome: null }, data: { outcome: input.outcome, outcomeReasonId: reason.id, outcomeNote: text(input.note), lessons: text(input.lessons), closedAt: new Date(), closedById: actor.id, version: { increment: 1 } } });
    if (changed.count !== 1) return { error: STALE };
    const label = OPPORTUNITY_OUTCOMES.find((outcome) => outcome.key === input.outcome)!.label;
    const cancelled = await tx.task.updateMany({ where: { opportunityId: opportunity.id, status: OPEN_TASK_STATUS_FILTER }, data: { status: "CANCELLED", closedReason: `Cơ hội kết thúc: ${label}` } });
    if (opportunity.expectedEventId) await closeLinkedReminders(tx, opportunity.expectedEventId, "OPPORTUNITY_CLOSED", `Cơ hội kết thúc: ${label}`);
    if (input.winnerCompetitorId) {
      await tx.opportunityCompetitor.updateMany({ where: { opportunityId: opportunity.id }, data: { isWinner: false } });
      await tx.opportunityCompetitor.upsert({ where: { opportunityId_competitorId: { opportunityId: opportunity.id, competitorId: input.winnerCompetitorId } }, create: { opportunityId: opportunity.id, competitorId: input.winnerCompetitorId, isWinner: true }, update: { isWinner: true } });
    }
    if (input.followUp) await tx.task.create({ data: { title: input.followUp.title.trim(), assigneeId: input.followUp.assigneeId, creatorId: actor.id, dueDate: input.followUp.dueDate, clientId: opportunity.clientId, sourceOpportunityId: opportunity.id, crmKind: "WINBACK", status: "TODO" } });
    await tx.opportunityStageEvent.create({ data: { opportunityId: opportunity.id, fromStage: opportunity.stage, toStage: opportunity.stage, outcome: input.outcome, actorId: actor.id, actorName: actor.name, note: text(input.note) } });
    return { ok: true, cancelledTasks: cancelled.count, version: input.expectedVersion + 1 };
  });
}
