import type { Prisma, PrismaClient } from "@prisma/client";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { loadTaskResource } from "./actor";
import { crmCan, type CrmActor, type CrmAction } from "./policy";

type Actor = CrmActor & { name: string };
type Failure = { error: string };
type OwnerResult = { clientId: string; opportunityId: string | null };
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const INVALID = "Thông tin việc chăm sóc không hợp lệ.";
const id = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 64;
const validDate = (v: unknown): v is Date => v instanceof Date && Number.isFinite(v.getTime());

async function loadLockedTask(tx: Prisma.TransactionClient, actor: Actor, taskId: string, action: CrmAction) {
  const initial = await tx.task.findUnique({ where: { id: taskId }, select: { projectId: true, clientId: true, opportunityId: true, opportunity: { select: { clientId: true } } } });
  const clientId = initial?.clientId ?? initial?.opportunity?.clientId;
  if (!initial || initial.projectId || !clientId) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientId}))`;
  await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
  if (initial.opportunityId) await tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${initial.opportunityId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
  const task = await tx.task.findUnique({ where: { id: taskId } });
  const resource = await loadTaskResource(tx, taskId);
  if (!task || task.projectId || task.clientId !== initial.clientId || task.opportunityId !== initial.opportunityId || !["TODO", "IN_PROGRESS"].includes(task.status) || !resource || !crmCan(actor, action, resource)) return null;
  return { task, clientId, opportunityId: task.opportunityId };
}

export async function assignCrmTask(db: PrismaClient, actor: Actor, input: { taskId: string; assigneeId: string; dueDate: Date }): Promise<({ ok: true; assigneeName: string } & OwnerResult) | Failure> {
  if (!id(input.taskId) || !id(input.assigneeId) || !validDate(input.dueDate)) return { error: INVALID };
  return db.$transaction(async tx => {
    const loaded = await loadLockedTask(tx, actor, input.taskId, "ASSIGN");
    if (!loaded) return { error: DENIED };
    const assignee = await tx.user.findFirst({ where: { id: input.assigneeId, isActive: true, deletedAt: null }, select: { name: true } });
    if (!assignee) return { error: "Chọn người làm đang hoạt động." };
    await tx.task.updateMany({ where: { id: input.taskId, status: OPEN_TASK_STATUS_FILTER }, data: { assigneeId: input.assigneeId, dueDate: input.dueDate } });
    if (input.assigneeId !== actor.id) await tx.notification.create({ data: { userId: input.assigneeId, type: "CRM_TASK_ASSIGNED", taskId: input.taskId, clientId: loaded.clientId, opportunityId: loaded.opportunityId, message: `${actor.name} giao cho bạn: ${loaded.task.title}.` } });
    return { ok: true as const, clientId: loaded.clientId, opportunityId: loaded.opportunityId, assigneeName: assignee.name };
  });
}

export async function postponeCrmTask(db: PrismaClient, actor: Actor, input: { taskId: string; reason: string; reviewDate: Date }): Promise<({ ok: true } & OwnerResult) | Failure> {
  if (!id(input.taskId) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 500 || !validDate(input.reviewDate)) return { error: "Nhập lý do hoãn và ngày xem lại." };
  return db.$transaction(async tx => {
    const loaded = await loadLockedTask(tx, actor, input.taskId, "EDIT_TASK");
    if (!loaded) return { error: DENIED };
    await tx.taskPostpone.create({ data: { taskId: input.taskId, fromDueDate: loaded.task.dueDate, toDueDate: input.reviewDate, reason: input.reason.trim(), actorId: actor.id, actorName: actor.name } });
    await tx.task.update({ where: { id: input.taskId }, data: { dueDate: input.reviewDate } });
    return { ok: true as const, clientId: loaded.clientId, opportunityId: loaded.opportunityId };
  });
}

export async function escalateCrmTask(db: PrismaClient, actor: Actor, taskId: string): Promise<({ ok: true } & OwnerResult) | Failure> {
  if (!id(taskId)) return { error: INVALID };
  return db.$transaction(async tx => {
    const loaded = await loadLockedTask(tx, actor, taskId, "EDIT_TASK");
    if (!loaded) return { error: DENIED };
    await tx.task.update({ where: { id: taskId }, data: { escalatedAt: new Date() } });
    return { ok: true as const, clientId: loaded.clientId, opportunityId: loaded.opportunityId };
  });
}
