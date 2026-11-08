import type { Prisma } from "@prisma/client";
import { crmEnabled } from "./features";
import { ARCHIVED_PROJECT_STATUS_KEYS, OPEN_TASK_STATUS_FILTER } from "./types";
import { ownerOf, type WorkOwnerKind } from "./workOwner";
export function openTaskOwnerScope(userId: string, crmOn = crmEnabled()): Prisma.TaskWhereInput {
  return { OR: [{ project: { status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] }, members: { some: { userId } } } }, ...(crmOn ? [{ opportunity: { outcome: null } }, { clientId: { not: null } }] : [])] };
}
export function myOpenTasksWhere(userId: string, crmOn = crmEnabled()): Prisma.TaskWhereInput {
  return { assigneeId: userId, status: OPEN_TASK_STATUS_FILTER, AND: [openTaskOwnerScope(userId, crmOn)] };
}
export function assignedByMeOpenWhere(userId: string, crmOn = crmEnabled()): Prisma.TaskWhereInput {
  return { creatorId: userId, assigneeId: { not: null }, NOT: { assigneeId: userId }, status: OPEN_TASK_STATUS_FILTER, AND: [openTaskOwnerScope(userId, crmOn)] };
}
export function teamMemberOpenTasksWhere(userId: string, crmOn = crmEnabled()): Prisma.TaskWhereInput { return myOpenTasksWhere(userId, crmOn); }
export function digestCrmTasksWhere(range: { start: Date; end: Date }, crmOn = crmEnabled()): Prisma.TaskWhereInput {
  if (!crmOn) return { id: "__none__" };
  return { status: OPEN_TASK_STATUS_FILTER, dueDate: { lt: range.end }, assigneeId: { not: null }, assignee: { isActive: true }, OR: [{ clientId: { not: null } }, { opportunity: { outcome: null } }] };
}
export const taskOwnerSelect = { projectId: true, opportunityId: true, clientId: true, project: { select: { id: true, name: true, color: true, status: true } }, opportunity: { select: { id: true, name: true } }, client: { select: { id: true, name: true } } } as const;
export type TaskOwnerDisplay = { kind: WorkOwnerKind; id: string; name: string; color: string | null };
export type TaskOwnerRow = { projectId: string | null; opportunityId: string | null; clientId: string | null; project: { id: string; name: string; color: string } | null; opportunity: { id: string; name: string } | null; client: { id: string; name: string } | null };
export function toTaskOwnerDisplay(row: TaskOwnerRow): TaskOwnerDisplay {
  const owner = ownerOf(row);
  const record = owner.kind === "PROJECT" ? row.project : owner.kind === "OPPORTUNITY" ? row.opportunity : row.client;
  if (!record) throw new Error("Không tìm thấy nơi sở hữu công việc.");
  return { ...owner, name: record.name, color: owner.kind === "PROJECT" ? row.project!.color : null };
}
