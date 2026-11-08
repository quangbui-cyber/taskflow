import type { PrismaClient } from "@prisma/client";
import { loadClientResource, loadOpportunityResource } from "./actor";
import { crmCan, type CrmActor } from "./policy";
import { lockOpportunity, openOpportunityTx } from "./opportunityWorkflow";
import { validateOpenOpportunityInput, type OpenOpportunityInput } from "./opportunityStage";
import { TOUCHPOINT_KINDS } from "./labels";

type Actor = CrmActor & { name: string };
type Failure = { error: string; fieldErrors?: Record<string, string> };
type LogResult = { ok: true; touchpointId: string; openedOpportunityId: string | null } | Failure;
type Next = { mode: "NEXT_STEP"; title: string; assigneeId: string; dueDate: Date }
  | { mode: "WAIT"; reason: string; reviewDate: Date };
export type TouchpointInput = {
  clientRequestId: string; clientId: string; opportunityId: string | null;
  kind: string; occurredAt: Date; outcomeLevel: 1 | 2 | 3 | 4; notes: string | null;
  openOpportunity: OpenOpportunityInput | null; next: Next;
  completeTaskId: string | null; confirmDraftId: string | null;
};
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const INVALID = "Thông tin điểm chạm không hợp lệ.";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 64;
const text = (value: unknown, limit: number): value is string => typeof value === "string" && !!value.trim() && value.trim().length <= limit;
function date(value: unknown): Date | null {
  if (!(value instanceof Date) && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || value.length > 40)) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function validateTouchpointInput(raw: unknown): { ok: true; value: TouchpointInput } | { errors: Record<string, string> } {
  const input = record(raw) ? raw : {};
  const errors: Record<string, string> = {};
  if (!id(input.clientRequestId)) errors.clientRequestId = INVALID;
  if (!id(input.clientId)) errors.clientId = "Chọn khách hàng.";
  for (const key of ["opportunityId", "completeTaskId", "confirmDraftId"] as const) {
    if (input[key] != null && !id(input[key])) errors[key] = INVALID;
  }
  if (!TOUCHPOINT_KINDS.some((kind) => kind.key === input.kind)) errors.kind = "Chọn loại điểm chạm.";
  const occurredAt = date(input.occurredAt);
  if (!occurredAt) errors.occurredAt = "Nhập ngày điểm chạm hợp lệ.";
  if (![1, 2, 3, 4].includes(input.outcomeLevel as number)) errors.outcomeLevel = "Chọn mức kết quả.";
  if (input.notes != null && (typeof input.notes !== "string" || input.notes.length > 2000)) errors.notes = "Ghi chú tối đa 2000 ký tự.";
  let next: Next | null = null;
  if (record(input.next) && input.next.mode === "WAIT") {
    const reviewDate = date(input.next.reviewDate);
    if (!text(input.next.reason, 500) || !reviewDate) errors.next = "Nhập lý do chờ và ngày xem lại.";
    else next = { mode: "WAIT", reason: input.next.reason.trim(), reviewDate };
  } else if (record(input.next) && input.next.mode === "NEXT_STEP") {
    const dueDate = date(input.next.dueDate);
    if (text(input.next.title, 200) && id(input.next.assigneeId) && dueDate) next = { mode: "NEXT_STEP", title: input.next.title.trim(), assigneeId: input.next.assigneeId, dueDate };
  }
  if (!next && !errors.next) errors.next = "Nhập việc cần làm và hạn, hoặc chọn Chờ khách.";
  let openOpportunity: OpenOpportunityInput | null = null;
  if (input.openOpportunity != null) {
    if (!record(input.openOpportunity) || input.opportunityId != null || input.outcomeLevel !== 4) errors.openOpportunity = "Chỉ mở Cơ hội khi có nhu cầu xác nhận và chưa gắn Cơ hội.";
    else {
      const open = input.openOpportunity;
      const parsed = validateOpenOpportunityInput({ clientId: input.clientId, programTypeCode: open.programTypeCode, expectedYear: open.expectedYear, expectedMonth: open.expectedMonth, expectedQuarter: open.expectedQuarter, demandSignal: open.demandSignal, source: "OTHER" });
      if ("errors" in parsed) errors.openOpportunity = Object.values(parsed.errors)[0];
      else openOpportunity = parsed.value;
    }
  }
  if (Object.keys(errors).length) return { errors };
  return { ok: true, value: {
    clientRequestId: input.clientRequestId as string, clientId: input.clientId as string, opportunityId: (input.opportunityId as string | undefined) ?? null,
    kind: input.kind as string, occurredAt: occurredAt!, outcomeLevel: input.outcomeLevel as TouchpointInput["outcomeLevel"], notes: typeof input.notes === "string" ? input.notes.trim() || null : null,
    openOpportunity, next: next!, completeTaskId: (input.completeTaskId as string | undefined) ?? null, confirmDraftId: (input.confirmDraftId as string | undefined) ?? null,
  } };
}

export async function logTouchpoint(db: PrismaClient, actor: Actor, raw: unknown): Promise<LogResult> {
  const parsed = validateTouchpointInput(raw);
  if ("errors" in parsed) return { error: Object.values(parsed.errors)[0], fieldErrors: parsed.errors };
  const input = parsed.value;
  const result = await db.$transaction(async (tx): Promise<LogResult & { notice?: { userId: string; taskId: string; title: string; ownerName: string; opportunityId: string | null } }> => {
    // A request key is global; serialize it before the per-Client critical section.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`touchpoint:${input.clientRequestId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.clientId}))`;
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${input.clientId} FOR UPDATE`;
    if (input.opportunityId) await lockOpportunity(tx, input.opportunityId);
    const client = await tx.client.findUnique({ where: { id: input.clientId }, select: { name: true } });
    const opportunity = input.opportunityId ? await tx.opportunity.findUnique({ where: { id: input.opportunityId }, select: { clientId: true, name: true } }) : null;
    if (!client || (input.opportunityId && opportunity?.clientId !== input.clientId)) return { error: DENIED };
    const owner = input.opportunityId ? await loadOpportunityResource(tx, input.opportunityId) : await loadClientResource(tx, input.clientId);
    if (!owner) return { error: DENIED };
    if (input.completeTaskId) await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${input.completeTaskId} FOR UPDATE`;
    const completeTask = input.completeTaskId ? await tx.task.findUnique({ where: { id: input.completeTaskId }, select: { id: true, status: true, projectId: true, clientId: true, opportunityId: true, assigneeId: true, creatorId: true } }) : null;
    const matchingTask = completeTask && !completeTask.projectId && (input.opportunityId ? completeTask.opportunityId === input.opportunityId && completeTask.clientId === null : completeTask.clientId === input.clientId && completeTask.opportunityId === null);
    const taskResource = matchingTask ? { kind: "TASK" as const, owner, assigneeId: completeTask.assigneeId, creatorId: completeTask.creatorId } : null;
    if (!crmCan(actor, "LOG_TOUCHPOINT", owner) && !(taskResource && completeTask?.assigneeId === actor.id && crmCan(actor, "LOG_TOUCHPOINT", taskResource))) return { error: DENIED };
    if (input.completeTaskId && (!taskResource || !crmCan(actor, "EDIT_TASK", taskResource))) return { error: DENIED };
    const existing = await tx.touchpoint.findUnique({ where: { clientRequestId: input.clientRequestId } });
    if (existing) {
      if (existing.clientId !== input.clientId || existing.authorId !== actor.id || (input.opportunityId && existing.opportunityId !== input.opportunityId) || (input.confirmDraftId && existing.id !== input.confirmDraftId)) return { error: DENIED };
      return { ok: true, touchpointId: existing.id, openedOpportunityId: input.openOpportunity ? existing.opportunityId : null };
    }
    if (completeTask && !["TODO", "IN_PROGRESS"].includes(completeTask.status)) return { error: "Việc đã kết thúc. Tải lại trang để xem bản mới." };
    const assigneeId = input.next.mode === "NEXT_STEP" ? input.next.assigneeId : actor.id;
    if (!await tx.user.findFirst({ where: { id: assigneeId, isActive: true, deletedAt: null }, select: { id: true } })) return { error: "Chọn người làm đang hoạt động." };
    const draft = input.confirmDraftId ? await tx.touchpoint.findUnique({ where: { id: input.confirmDraftId } }) : null;
    if (input.confirmDraftId && (!draft || draft.status !== "DRAFT" || draft.clientId !== input.clientId || draft.opportunityId !== input.opportunityId)) return { error: "Điểm chạm nháp không còn phù hợp để xác nhận." };
    let openedOpportunityId: string | null = null;
    if (input.openOpportunity) {
      const opened = await openOpportunityTx(tx, actor, input.openOpportunity);
      if ("error" in opened) return opened;
      openedOpportunityId = opened.opportunityId;
    }
    const opportunityId = openedOpportunityId ?? input.opportunityId;
    const ownerName = openedOpportunityId ? (await tx.opportunity.findUniqueOrThrow({ where: { id: openedOpportunityId }, select: { name: true } })).name : opportunity?.name ?? client.name;
    const now = new Date();
    const data = { clientId: input.clientId, opportunityId, kind: input.kind, occurredAt: input.occurredAt, outcomeLevel: input.outcomeLevel, notes: input.notes, clientRequestId: input.clientRequestId, status: "CONFIRMED", authorId: actor.id, confirmedById: actor.id, confirmedAt: now };
    const touchpoint = draft ? await tx.touchpoint.update({ where: { id: draft.id }, data }) : await tx.touchpoint.create({ data });
    const task = await tx.task.create({ data: {
      title: input.next.mode === "WAIT" ? `Chờ khách: ${input.next.reason}` : input.next.title,
      dueDate: input.next.mode === "WAIT" ? input.next.reviewDate : input.next.dueDate, assigneeId, creatorId: actor.id,
      clientId: opportunityId ? null : input.clientId, opportunityId, status: "TODO",
      crmKind: input.next.mode === "WAIT" ? "WAIT" : input.outcomeLevel === 3 ? "APPOINTMENT" : "NEXT_STEP",
    } });
    if (completeTask) await tx.task.update({ where: { id: completeTask.id }, data: { status: "DONE", completedAt: now } });
    return { ok: true, touchpointId: touchpoint.id, openedOpportunityId, ...(assigneeId === actor.id ? {} : { notice: { userId: assigneeId, taskId: task.id, title: task.title, ownerName, opportunityId } }) };
  });
  if ("ok" in result && result.notice) {
    const notice = result.notice;
    try {
      // Use the caller's database, never the global client (also safe in local integration tests).
      await db.notification.create({ data: { dedupeKey: `crm-task-assigned:${notice.taskId}`, userId: notice.userId, taskId: notice.taskId, type: "CRM_TASK_ASSIGNED", clientId: input.clientId, opportunityId: notice.opportunityId, message: `${actor.name} giao cho bạn: ${notice.title} · ${notice.ownerName}.` } });
    } catch { console.warn("CRM task assignment notification could not be saved."); }
  }
  return "ok" in result ? { ok: true, touchpointId: result.touchpointId, openedOpportunityId: result.openedOpportunityId } : result;
}

/** Keep only provenance and date. No recap content is read or copied into CRM. */
export async function produceMeetingDrafts(db: PrismaClient, meetingId: string, sourceType: "RECAP" | "MEETING") {
  if (!id(meetingId) || !["RECAP", "MEETING"].includes(sourceType)) return { created: 0 };
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${meetingId} FOR UPDATE`;
    const meeting = await tx.meeting.findUnique({ where: { id: meetingId }, select: { title: true, startAt: true, status: true, clientId: true, opportunityId: true, opportunity: { select: { clientId: true } } } });
    const clientId = meeting?.opportunity?.clientId ?? meeting?.clientId;
    if (!meeting || !clientId || meeting.status === "CANCELLED") return { created: 0 };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientId}))`;
    // Both producers share a single meeting provenance, including dismissed/confirmed rows.
    if (await tx.touchpoint.findFirst({ where: { sourceType: { in: ["RECAP", "MEETING"] }, sourceId: meetingId, clientId }, select: { id: true } })) return { created: 0 };
    const created = await tx.touchpoint.createMany({ data: [{ clientId, opportunityId: meeting.opportunityId, kind: "MEETING", occurredAt: meeting.startAt, status: "DRAFT", outcomeLevel: null, notes: null, sourceType, sourceId: meetingId }], skipDuplicates: true });
    if (created.count) {
      const client = await tx.client.findUnique({ where: { id: clientId }, select: { picAccount: { select: { user: { select: { id: true, isActive: true, deletedAt: true } } } } } });
      const pic = client?.picAccount?.user;
      if (pic?.isActive && !pic.deletedAt) await tx.notification.create({ data: { dedupeKey: `crm-meeting-draft:${meetingId}:${clientId}`, userId: pic.id, type: "CRM_DRAFT", clientId, opportunityId: meeting.opportunityId, meetingId, message: `Có điểm chạm nháp từ cuộc họp ${meeting.title} chờ xác nhận.` } });
    }
    return { created: created.count };
  });
}

export async function dismissDraft(db: PrismaClient, actor: Actor, draftId: string): Promise<{ ok: true; clientId: string; opportunityId: string | null } | Failure> {
  if (!id(draftId)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const initial = await tx.touchpoint.findUnique({ where: { id: draftId }, select: { clientId: true } });
    if (!initial) return { error: DENIED };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.clientId}))`;
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${initial.clientId} FOR UPDATE`;
    const draft = await tx.touchpoint.findUnique({ where: { id: draftId } });
    const owner = draft ? await loadClientResource(tx, draft.clientId) : null;
    if (!draft || !owner || !crmCan(actor, "LOG_TOUCHPOINT", owner)) return { error: DENIED };
    if (!["DRAFT", "DISMISSED"].includes(draft.status)) return { error: "Điểm chạm đã được xác nhận." };
    await tx.touchpoint.updateMany({ where: { id: draftId, status: "DRAFT" }, data: { status: "DISMISSED" } });
    return { ok: true, clientId: draft.clientId, opportunityId: draft.opportunityId };
  });
}
