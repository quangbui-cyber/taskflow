import type { Prisma, PrismaClient } from "@prisma/client";
import type { UserPickerOption } from "../../components/UserPicker";
import { loadProgramTypes } from "../programTypes";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { crmCan, type CrmActor } from "./policy";

type Db = PrismaClient | Prisma.TransactionClient;
type Filter = { clientId?: string };
const picSelect = { userId: true, teamId: true } as const;
type ClientOwner = { responsibleTeamId: string | null; picAccount: { userId: string | null; teamId: string | null } | null };
function resource(c: ClientOwner) { return { kind: "CLIENT" as const, picUserId: c.picAccount?.userId ?? null, teamId: c.responsibleTeamId ?? c.picAccount?.teamId ?? null }; }
function editableWhere(actor: CrmActor): Prisma.ClientWhereInput {
  return actor.role === "ADMIN" ? {} : { OR: [
    { picAccount: { userId: actor.id } }, { responsibleTeamId: { in: actor.managedTeamIds } },
    { responsibleTeamId: null, picAccount: { teamId: { in: actor.managedTeamIds } } },
  ] };
}
export async function loadTouchpointDialogOptions(db: Db, actor: CrmActor, filter: Filter = {}) {
  const assigned = await db.task.findMany({ where: { assigneeId: actor.id, status: OPEN_TASK_STATUS_FILTER, projectId: null, OR: [{ clientId: { not: null } }, { opportunity: { outcome: null } }] }, select: { id: true, clientId: true, opportunityId: true, opportunity: { select: { clientId: true } } }, orderBy: [{ dueDate: "asc" }, { id: "asc" }] });
  const ids = [...new Set(assigned.map(task => task.clientId ?? task.opportunity?.clientId).filter((id): id is string => !!id))];
  const [clients, users, programs] = await Promise.all([
    db.client.findMany({ where: { AND: [filter.clientId ? { id: filter.clientId } : {}, { OR: [editableWhere(actor), { id: { in: ids } }, { clientOpportunities: { some: { outcome: null, OR: [{ picAccount: { userId: actor.id } }, { responsibleTeamId: { in: actor.managedTeamIds } }, { responsibleTeamId: null, picAccount: { teamId: { in: actor.managedTeamIds } } }] } } }] }] }, select: { id: true, name: true, responsibleTeamId: true, picAccount: { select: picSelect }, clientOpportunities: { where: { outcome: null }, select: { id: true, name: true, responsibleTeamId: true, picAccount: { select: picSelect } }, orderBy: { name: "asc" } } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 500 }),
    db.user.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true, avatarUrl: true }, orderBy: { name: "asc" } }),
    loadProgramTypes(db, { activeOnly: true }),
  ]);
  return {
    clients: clients.map(c => {
      const openOpportunities: { id: string; name: string; canLog?: boolean }[] = c.clientOpportunities.map(o => ({ id: o.id, name: o.name, canLog: crmCan(actor, "LOG_TOUCHPOINT", { kind: "OPPORTUNITY", picUserId: o.picAccount?.userId ?? null, teamId: o.responsibleTeamId ?? o.picAccount?.teamId ?? c.responsibleTeamId ?? c.picAccount?.teamId ?? null, closed: false }) }));
      return { id: c.id, name: c.name, picUserId: c.picAccount?.userId ?? null, openOpportunities, canLogClient: crmCan(actor, "LOG_TOUCHPOINT", resource(c)), assignedTasks: assigned.filter(task => (task.clientId ?? task.opportunity?.clientId) === c.id).map(task => ({ id: task.id, opportunityId: task.opportunityId })) };
    }).filter(c => c.canLogClient || ids.includes(c.id) || c.openOpportunities.some(o => o.canLog)),
    users: users satisfies UserPickerOption[], programTypes: programs.map(p => ({ code: p.code, label: p.label })),
  };
}
export async function loadOpenOpportunityDialogOptions(db: Db, actor: CrmActor, filter: Filter = {}) {
  const [clients, programs, picAccounts] = await Promise.all([
    db.client.findMany({ where: { AND: [editableWhere(actor), filter.clientId ? { id: filter.clientId } : {}] }, select: { id: true, name: true, picAccountId: true, responsibleTeamId: true, picAccount: { select: picSelect }, clientBuyingUnits: { where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 500 }),
    loadProgramTypes(db, { activeOnly: true }),
    db.account.findMany({ where: { user: { isActive: true, deletedAt: null } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { clients: clients.filter(c => crmCan(actor, "EDIT", resource(c))).map(c => ({ id: c.id, name: c.name, picAccountId: c.picAccountId, buyingUnits: c.clientBuyingUnits })), programTypes: programs.map(p => ({ code: p.code, label: p.label })), picAccounts };
}
export type TouchpointDialogOptions = Awaited<ReturnType<typeof loadTouchpointDialogOptions>>;
export type OpenOpportunityDialogOptions = Awaited<ReturnType<typeof loadOpenOpportunityDialogOptions>>;

/** Options for one persisted Opportunity; this never grants Client opening/edit rights. */
export async function loadOpportunityEditDialogOptions(db: Db, actor: CrmActor, opportunityId: string) {
  const o = await db.opportunity.findUnique({ where: { id: opportunityId }, select: {
    outcome: true, clientId: true, buyingUnitId: true, programTypeCode: true, picAccountId: true, responsibleTeamId: true,
    picAccount: { select: picSelect }, client: { select: { responsibleTeamId: true, picAccount: { select: picSelect } } },
  } });
  if (!o || !crmCan(actor, "EDIT", { kind: "OPPORTUNITY", closed: o.outcome !== null, picUserId: o.picAccount?.userId ?? null, teamId: o.responsibleTeamId ?? o.picAccount?.teamId ?? o.client.responsibleTeamId ?? o.client.picAccount?.teamId ?? null })) return null;
  const [base, buyingUnits, usedProgram, currentPic] = await Promise.all([
    loadOpenOpportunityDialogOptions(db, actor, { clientId: o.clientId }),
    db.buyingUnit.findMany({ where: { clientId: o.clientId, OR: [{ active: true }, { id: o.buyingUnitId ?? "__none__" }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.programType.findUnique({ where: { code: o.programTypeCode }, select: { code: true, label: true } }),
    o.picAccountId ? db.account.findUnique({ where: { id: o.picAccountId }, select: { id: true, name: true } }) : null,
  ]);
  return { buyingUnits, programTypes: usedProgram && !base.programTypes.some(p => p.code === usedProgram.code) ? [...base.programTypes, usedProgram] : base.programTypes,
    picAccounts: currentPic && !base.picAccounts.some(p => p.id === currentPic.id) ? [...base.picAccounts, currentPic] : base.picAccounts };
}
