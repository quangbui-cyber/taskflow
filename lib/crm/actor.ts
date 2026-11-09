import { cache } from "react";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import type { CrmActor, CrmOwnerResource, CrmResource } from "./policy";

type Db = PrismaClient | Prisma.TransactionClient;

export async function loadCrmActorFrom(db: Db, user: { id: string; role: string }): Promise<CrmActor> {
  const [account, managers, storedUser] = await Promise.all([
    db.account.findUnique({ where: { userId: user.id }, select: { id: true } }),
    db.crmTeamManager.findMany({ where: { userId: user.id }, select: { teamId: true } }),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { role: true, isCrmDataSteward: true, isActive: true } }),
  ]);
  if (!storedUser.isActive) throw new Error("Tài khoản không còn hoạt động.");
  return { id: user.id, role: storedUser.role, accountId: account?.id ?? null, managedTeamIds: managers.map(({ teamId }) => teamId), isDataSteward: storedUser.isCrmDataSteward };
}

export const loadCrmActor = cache((user: { id: string; role: string }): Promise<CrmActor> => loadCrmActorFrom(prisma, user));

export async function loadClientResource(db: Db, clientId: string): Promise<CrmOwnerResource | null> {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { responsibleTeamId: true, picAccount: { select: { userId: true, teamId: true } } } });
  if (!client) return null;
  return { kind: "CLIENT", picUserId: client.picAccount?.userId ?? null, teamId: client.responsibleTeamId ?? client.picAccount?.teamId ?? null };
}

export async function loadOpportunityResource(db: Db, opportunityId: string): Promise<CrmOwnerResource | null> {
  const opportunity = await db.opportunity.findUnique({ where: { id: opportunityId }, select: { outcome: true, responsibleTeamId: true, picAccount: { select: { userId: true, teamId: true } }, client: { select: { responsibleTeamId: true, picAccount: { select: { teamId: true } } } } } });
  if (!opportunity) return null;
  return { kind: "OPPORTUNITY", picUserId: opportunity.picAccount?.userId ?? null, teamId: opportunity.responsibleTeamId ?? opportunity.picAccount?.teamId ?? opportunity.client.responsibleTeamId ?? opportunity.client.picAccount?.teamId ?? null, closed: opportunity.outcome !== null };
}

export async function loadTaskResource(db: Db, taskId: string): Promise<CrmResource | null> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { clientId: true, opportunityId: true, projectId: true, creatorId: true, assigneeId: true } });
  if (!task || task.projectId) return null;
  const owner = task.opportunityId ? await loadOpportunityResource(db, task.opportunityId) : task.clientId ? await loadClientResource(db, task.clientId) : null;
  return owner ? { kind: "TASK", owner, creatorId: task.creatorId, assigneeId: task.assigneeId } : null;
}
