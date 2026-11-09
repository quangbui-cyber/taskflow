import type { Prisma, PrismaClient } from "@prisma/client";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { vnDayStart } from "./dates";
import { daysInStage, formatExpectedTiming } from "./opportunityFormat";

type Db = PrismaClient | Prisma.TransactionClient;
export const OPPORTUNITY_PAGE_SIZE = 50;
export type OpportunityListView = "OPEN" | "CARE" | "BRIEF" | "BIDDING" | "CLOSED";
export type OpportunityListParams = { view: OpportunityListView; picAccountId: string | null; teamId: string | null; programTypeCode: string | null; page: number };
export function parseOpportunityListParams(raw: Record<string, string | string[] | undefined>): OpportunityListParams {
  const value = (key: string) => typeof raw[key] === "string" ? raw[key].trim() : "";
  const view = value("view");
  const page = value("page");
  return {
    view: (["OPEN", "CARE", "BRIEF", "BIDDING", "CLOSED"] as const).find(v => v === view) ?? "OPEN",
    picAccountId: value("pic").slice(0, 64) || null,
    teamId: value("team").slice(0, 64) || null,
    programTypeCode: value("program").slice(0, 64) || null,
    page: /^\d+$/.test(page) ? Math.max(1, Math.min(100, Number(page))) : 1,
  };
}
type BaseRow = { id: string; name: string; clientId: string; clientName: string; buyingUnitName: string | null; picName: string | null };
export type OpenOpportunityRow = BaseRow & {
  programTypeCode: string; programTypeLabel: string; stage: string; timingLabel: string;
  budgetMin: number | null; budgetMax: number | null;
  nextStep: { title: string; dueDate: Date | null; overdue: boolean } | null; daysInStage: number;
};
export type ClosedOpportunityRow = BaseRow & {
  outcome: string; reasonLabel: string | null; outcomeNote: string | null; legacyStatus: string | null;
  closedAt: Date | null; contractValue: number | null; projectId: string | null;
};
export type OpportunityListData = { view: OpportunityListView; total: number; hasMore: boolean; openRows?: OpenOpportunityRow[]; closedRows?: ClosedOpportunityRow[] };
const nextTask = {
  where: { status: OPEN_TASK_STATUS_FILTER },
  orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
  take: 1,
  select: { title: true, dueDate: true },
} satisfies Prisma.TaskFindManyArgs;
const rowSelect = {
  id: true, name: true, clientId: true, client: { select: { name: true } }, buyingUnit: { select: { name: true } },
  picAccount: { select: { name: true } }, programTypeCode: true, programType: { select: { label: true } },
  stage: true, expectedYear: true, expectedMonth: true, expectedQuarter: true, budgetMin: true, budgetMax: true,
  outcome: true, outcomeNote: true, outcomeReason: { select: { label: true } }, legacyStatus: true, closedAt: true,
  contractValue: true, project: { select: { id: true } }, createdAt: true,
  opportunityStageEvents: { orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 1, select: { occurredAt: true } },
  taskOpportunity: nextTask,
} satisfies Prisma.OpportunitySelect;

export async function loadOpportunityList(db: Db, params: OpportunityListParams, now: Date): Promise<OpportunityListData> {
  const conditions: Prisma.OpportunityWhereInput[] = [{ outcome: params.view === "CLOSED" ? { not: null } : null }];
  if (!["OPEN", "CLOSED"].includes(params.view)) conditions.push({ stage: params.view });
  if (params.picAccountId) conditions.push({ picAccountId: params.picAccountId });
  if (params.programTypeCode) conditions.push({ programTypeCode: params.programTypeCode });
  if (params.teamId) conditions.push({ OR: [
    { responsibleTeamId: params.teamId },
    { responsibleTeamId: null, picAccount: { teamId: params.teamId } },
    { responsibleTeamId: null, picAccountId: null, client: { OR: [
      { responsibleTeamId: params.teamId },
      { responsibleTeamId: null, picAccount: { teamId: params.teamId } },
    ] } },
  ] });
  const where: Prisma.OpportunityWhereInput = { AND: conditions };
  const skip = (params.page - 1) * OPPORTUNITY_PAGE_SIZE;
  const today = vnDayStart(now);
  if (params.view === "CLOSED") {
    const [total, rows] = await Promise.all([
      db.opportunity.count({ where }),
      db.opportunity.findMany({ where, select: rowSelect, orderBy: [{ closedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }, { id: "asc" }], skip, take: OPPORTUNITY_PAGE_SIZE + 1 }),
    ]);
    return { view: params.view, total, hasMore: rows.length > OPPORTUNITY_PAGE_SIZE, closedRows: rows.slice(0, OPPORTUNITY_PAGE_SIZE).map(row => ({
      id: row.id, name: row.name, clientId: row.clientId, clientName: row.client.name, buyingUnitName: row.buyingUnit?.name ?? null,
      picName: row.picAccount?.name ?? null, outcome: row.outcome!, reasonLabel: row.outcomeReason?.label ?? null,
      outcomeNote: row.outcomeNote, legacyStatus: row.legacyStatus, closedAt: row.closedAt,
      contractValue: row.outcome === "WON" && row.contractValue !== null ? Number(row.contractValue) : null,
      projectId: row.project?.id ?? null,
    })) };
  }
  // Prisma cannot order parents by the earliest filtered child dueDate. Sort only
  // the compact keys globally, then hydrate at most 51 rows (never sort one page).
  const keys = await db.opportunity.findMany({ where, select: { id: true, name: true, taskOpportunity: { ...nextTask, select: { dueDate: true } } } });
  keys.sort((a, b) => Number(!!a.taskOpportunity.length) - Number(!!b.taskOpportunity.length)
    || (a.taskOpportunity[0]?.dueDate?.getTime() ?? Infinity) - (b.taskOpportunity[0]?.dueDate?.getTime() ?? Infinity)
    || a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id));
  const ids = keys.slice(skip, skip + OPPORTUNITY_PAGE_SIZE + 1).map(row => row.id);
  const rows = ids.length ? await db.opportunity.findMany({ where: { AND: [where, { id: { in: ids } }] }, select: rowSelect, take: OPPORTUNITY_PAGE_SIZE + 1 }) : [];
  const byId = new Map(rows.map(row => [row.id, row]));
  return { view: params.view, total: keys.length, hasMore: skip + OPPORTUNITY_PAGE_SIZE < keys.length, openRows: ids.slice(0, OPPORTUNITY_PAGE_SIZE).flatMap(id => {
    const row = byId.get(id);
    if (!row) return [];
    const task = row.taskOpportunity[0];
    return [{ id: row.id, name: row.name, clientId: row.clientId, clientName: row.client.name, buyingUnitName: row.buyingUnit?.name ?? null,
      picName: row.picAccount?.name ?? null, programTypeCode: row.programTypeCode, programTypeLabel: row.programType.label,
      stage: row.stage, timingLabel: formatExpectedTiming(row), budgetMin: row.budgetMin === null ? null : Number(row.budgetMin),
      budgetMax: row.budgetMax === null ? null : Number(row.budgetMax),
      nextStep: task ? { title: task.title, dueDate: task.dueDate, overdue: !!task.dueDate && task.dueDate < today } : null,
      daysInStage: daysInStage(row.opportunityStageEvents[0]?.occurredAt ?? row.createdAt, now),
    }];
  }) };
}

export async function loadOpportunityFilterOptions(db: Db) {
  const [pics, teams, programTypes] = await Promise.all([
    db.account.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    db.salesTeam.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    db.programType.findMany({ where: { OR: [{ active: true }, { opportunities: { some: {} } }] }, select: { code: true, label: true }, orderBy: [{ order: "asc" }, { code: "asc" }] }),
  ]);
  return { pics, teams, programTypes };
}
