import type { Prisma, PrismaClient } from "@prisma/client";
import { ownerOf, ownerWhere, type WorkOwner } from "./workOwner";
import { crmCan, type CrmActor } from "./crm/policy";
import { loadClientResource, loadOpportunityResource } from "./crm/actor";
import { OPEN_TASK_STATUS_FILTER } from "./types";
type Db = PrismaClient | Prisma.TransactionClient;
type User = { id: string; role: string };
const denied = { error: "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team." };
async function actorWith(db: Db, user: User): Promise<CrmActor> {
  const [account, managers, stored] = await Promise.all([
    db.account.findUnique({ where: { userId: user.id }, select: { id: true } }),
    db.crmTeamManager.findMany({ where: { userId: user.id }, select: { teamId: true } }),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { isCrmDataSteward: true, role: true, isActive: true } }),
  ]);
  return { id: stored.isActive ? user.id : "", role: stored.role, accountId: account?.id ?? null, managedTeamIds: managers.map((m) => m.teamId), isDataSteward: stored.isCrmDataSteward };
}
async function resourceWith(db: Db, owner: WorkOwner) {
  return owner.kind === "CLIENT" ? loadClientResource(db, owner.id) : owner.kind === "OPPORTUNITY" ? loadOpportunityResource(db, owner.id) : null;
}
export async function loadTaskWithOwner(db: Db, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId }, include: { assignee: { select: { name: true } }, project: { select: { name: true, ownerId: true } } } });
  return task ? { ...task, owner: ownerOf(task) } : null;
}
export async function ownerParticipants(db: Db, owner: WorkOwner): Promise<string[]> {
  if (owner.kind === "PROJECT") return (await db.projectMember.findMany({ where: { projectId: owner.id }, select: { userId: true } })).map((m) => m.userId);
  const resource = await resourceWith(db, owner);
  if (!resource) return [];
  const [managers, tasks, members] = await Promise.all([
    resource.teamId ? db.crmTeamManager.findMany({ where: { teamId: resource.teamId }, select: { userId: true } }) : [],
    db.task.findMany({ where: { ...ownerWhere(owner), status: OPEN_TASK_STATUS_FILTER, assigneeId: { not: null } }, select: { assigneeId: true } }),
    owner.kind === "OPPORTUNITY" ? db.opportunityMember.findMany({ where: { opportunityId: owner.id }, select: { userId: true } }) : [],
  ]);
  return [...new Set([resource.picUserId, ...managers.map((m) => m.userId), ...tasks.map((t) => t.assigneeId), ...members.map((m) => m.userId)].filter((id): id is string => !!id))];
}
export async function assertOwnerAccess(db: Db, user: User, owner: WorkOwner, action: "CREATE_TASK" | "VIEW"): Promise<{ ok: true } | { error: string }> {
  if (owner.kind === "PROJECT") {
    const project = await db.project.findUnique({ where: { id: owner.id }, select: { id: true, members: { where: { userId: user.id }, select: { id: true } } } });
    return project && (user.role === "ADMIN" || project.members.length) ? { ok: true } : denied;
  }
  const resource = await resourceWith(db, owner);
  return resource && crmCan(await actorWith(db, user), action === "CREATE_TASK" ? "ASSIGN" : "VIEW", resource) ? { ok: true } : denied;
}
export async function assertTaskAccess(db: Db, user: User, taskId: string, action: "VIEW" | "EDIT" | "DELETE" | "COMMENT" | "FOLLOW") {
  const task = await loadTaskWithOwner(db, taskId);
  if (!task) return denied;
  if (task.owner.kind === "PROJECT") return "ok" in await assertOwnerAccess(db, user, task.owner, "VIEW") ? { task } : denied;
  const resource = await resourceWith(db, task.owner);
  const policyAction = action === "EDIT" ? "EDIT_TASK" : action === "DELETE" ? "ASSIGN" : "VIEW";
  return resource && crmCan(await actorWith(db, user), policyAction, { kind: "TASK", owner: resource, assigneeId: task.assigneeId, creatorId: task.creatorId }) ? { task } : denied;
}
export async function isValidAssignee(db: Db, owner: WorkOwner, userId: string): Promise<boolean> {
  if (owner.kind === "PROJECT") return !!await db.projectMember.findUnique({ where: { projectId_userId: { projectId: owner.id, userId } } });
  return !!await db.user.findFirst({ where: { id: userId, isActive: true, deletedAt: null }, select: { id: true } });
}
