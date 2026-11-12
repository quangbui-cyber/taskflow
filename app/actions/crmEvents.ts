"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CRM_DISABLED_MESSAGE } from "@/lib/features";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { createExpectedEvent, updateExpectedEvent, cancelExpectedEvent } from "@/lib/crm/eventService";
import { assignCrmTask, postponeCrmTask, escalateCrmTask } from "@/lib/crm/reviewActions";
import { changeClientPicOrTeam } from "@/lib/crm/clientService";
import { vnDateKey } from "@/lib/crm/dates";

const INVALID = "Thông tin CRM không hợp lệ.";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 64;
function date(v: unknown): Date | null {
  if (!(v instanceof Date) && (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) || v.length > 40)) return null;
  const value = v instanceof Date ? new Date(v) : new Date(v.length === 10 ? `${v}T17:00:00+07:00` : v);
  if (!Number.isFinite(value.getTime()) || (typeof v === "string" && v.length === 10 && vnDateKey(value) !== v)) return null;
  return value;
}
const shortDate = (value: Date) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).format(value);
function refresh(clientId: string, opportunityId?: string | null) {
  revalidatePath("/crm"); revalidatePath("/crm/clients"); revalidatePath(`/crm/clients/${clientId}`);
  revalidatePath("/tasks"); revalidatePath("/");
  if (opportunityId) revalidatePath(`/crm/opportunities/${opportunityId}`);
}

export async function createExpectedEventAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw)) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await createExpectedEvent(prisma, actor, raw);
  if ("error" in result) return result;
  refresh(result.clientId);
  return { success: `Đã lưu sự kiện và tạo ${result.steps} mốc nhắc.`, eventId: result.eventId, steps: result.steps };
}

export async function updateExpectedEventAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.eventId)) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await updateExpectedEvent(prisma, actor, raw);
  if ("error" in result) return result;
  refresh(result.clientId);
  return { success: `Đã cập nhật ngày, ${result.recomputed} mốc chưa làm được tính lại.`, recomputed: result.recomputed };
}

export async function cancelExpectedEventAction(eventId: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!id(eventId)) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await cancelExpectedEvent(prisma, actor, eventId);
  if ("error" in result) return result;
  refresh(result.clientId);
  return { success: "Đã hủy sự kiện dự kiến." };
}

export async function assignCrmTaskAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.taskId) || !id(raw.assigneeId)) return { error: INVALID };
  const dueDate = date(raw.dueDate); if (!dueDate) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await assignCrmTask(prisma, actor, { taskId: raw.taskId, assigneeId: raw.assigneeId, dueDate });
  if ("error" in result) return result;
  refresh(result.clientId, result.opportunityId);
  return { success: `Đã giao cho ${result.assigneeName} · hạn ${shortDate(dueDate)}.` };
}

export async function postponeCrmTaskAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.taskId) || typeof raw.reason !== "string") return { error: "Nhập lý do hoãn và ngày xem lại." };
  const reviewDate = date(raw.reviewDate); if (!reviewDate) return { error: "Nhập lý do hoãn và ngày xem lại." };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await postponeCrmTask(prisma, actor, { taskId: raw.taskId, reason: raw.reason, reviewDate });
  if ("error" in result) return result;
  refresh(result.clientId, result.opportunityId);
  return { success: `Đã hoãn đến ${shortDate(reviewDate)}.` };
}

export async function escalateCrmTaskAction(taskId: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!id(taskId)) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await escalateCrmTask(prisma, actor, taskId);
  if ("error" in result) return result;
  refresh(result.clientId, result.opportunityId);
  return { success: "Đã đánh dấu cần AD/AM." };
}

export async function assignClientPicAction(clientId: unknown, picAccountId: unknown, expectedVersion: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!id(clientId) || !id(picAccountId) || typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { responsibleTeamId: true } });
  if (!client) return { error: INVALID };
  const result = await changeClientPicOrTeam(prisma, actor, { clientId, picAccountId, expectedVersion, responsibleTeamId: client.responsibleTeamId });
  if ("error" in result) return result;
  refresh(clientId);
  return { success: "Đã giao PIC.", version: result.version };
}
