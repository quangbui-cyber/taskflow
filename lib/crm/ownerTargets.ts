import type { PrismaClient, Prisma } from "@prisma/client";
import { crmEnabled } from "../features";
import { crmCan, type CrmActor, type CrmOwnerResource } from "./policy";

type Db = PrismaClient | Prisma.TransactionClient;
export async function loadCrmOwnerTargets(db: Db, actor: CrmActor) {
  if (!crmEnabled() || !actor.id) return { opportunities: [], clients: [] };
  const [opportunities, clients] = await Promise.all([
    db.opportunity.findMany({ where: { outcome: null }, select: {
      id: true, name: true, responsibleTeamId: true,
      picAccount: { select: { userId: true, teamId: true } },
      client: { select: { name: true, responsibleTeamId: true, picAccount: { select: { teamId: true } } } },
    }, orderBy: { name: "asc" } }),
    db.client.findMany({ select: { id: true, name: true, responsibleTeamId: true, picAccount: { select: { userId: true, teamId: true } } }, orderBy: { name: "asc" } }),
  ]);
  return {
    opportunities: opportunities.filter((opportunity) => {
      const resource: CrmOwnerResource = { kind: "OPPORTUNITY", closed: false, picUserId: opportunity.picAccount?.userId ?? null, teamId: opportunity.responsibleTeamId ?? opportunity.picAccount?.teamId ?? opportunity.client.responsibleTeamId ?? opportunity.client.picAccount?.teamId ?? null };
      return crmCan(actor, "ASSIGN", resource);
    }).map((opportunity) => ({ id: opportunity.id, name: opportunity.name, clientName: opportunity.client.name })),
    clients: clients.filter((client) => crmCan(actor, "ASSIGN", { kind: "CLIENT", picUserId: client.picAccount?.userId ?? null, teamId: client.responsibleTeamId ?? client.picAccount?.teamId ?? null }))
      .map((client) => ({ id: client.id, name: client.name })),
  };
}
export type CrmOwnerTargets = Awaited<ReturnType<typeof loadCrmOwnerTargets>>;
