import type { Prisma, PrismaClient } from "@prisma/client";
import { KPI_RECOGNIZED_STATUSES } from "../kpi";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { vnDayStart } from "./dates";
import { computePersona } from "./persona";
import type { CrmSettings } from "./settings";
import type { TierValue } from "./settingsSchema";
import { cadenceWeeksFor, computeTier, revenue24mWindow, revenueBandFor, revenuePercentiles } from "./tier";

type Db = PrismaClient | Prisma.TransactionClient;
export const CLIENT_PAGE_SIZE = 50;
export type ClientListFilters = {
  q?: string;
  tier?: TierValue;
  picAccountId?: string;
  teamId?: string;
  status?: "OVERDUE" | "NO_NEXT_STEP" | "ON_TRACK" | "PENDING_PIC_CONFIRM";
  take?: number;
  skip?: number;
};
const picSelect = { id: true, name: true, userId: true, teamId: true, team: { select: { id: true, name: true } } } as const;

export async function loadClientRevenue24m(db: Db, now: Date, clientIds?: string[]): Promise<Map<string, number>> {
  const range = revenue24mWindow(now);
  const rows = await db.project.groupBy({
    by: ["clientId"],
    where: { category: "CLIENT", clientId: clientIds ? { in: clientIds } : { not: null }, status: { in: KPI_RECOGNIZED_STATUSES }, onProcessAt: { gte: range.start, lt: range.end } },
    _sum: { revenue: true },
  });
  return new Map(rows.filter((row) => row.clientId !== null).map((row) => [row.clientId!, row._sum.revenue ?? 0]));
}

function tierDetails(clientId: string, potentialLevel: string | null, revenue: Map<string, number>, percentiles: Map<string, number>, settings: CrmSettings) {
  const percentile = percentiles.get(clientId) ?? null;
  const band = revenueBandFor(percentile, settings.tierMatrix.revenueBands);
  const computed = computeTier({ potentialLevel, revenueBand: band?.key ?? null, matrix: settings.tierMatrix, scale: settings.potentialScale });
  return { ...computed, revenue24m: revenue.get(clientId) ?? 0, revenuePercentile: percentile, revenueBand: band, cadenceWeeks: cadenceWeeksFor(computed.tier, settings.cadenceWeeks) };
}

export async function loadClientList(db: Db, filters: ClientListFilters, settings: CrmSettings, now: Date) {
  const conditions: Prisma.ClientWhereInput[] = [];
  if (filters.q?.trim()) conditions.push({ name: { contains: filters.q.trim().slice(0, 200), mode: "insensitive" } });
  if (filters.picAccountId) conditions.push({ picAccountId: filters.picAccountId });
  if (filters.teamId) conditions.push({ OR: [{ responsibleTeamId: filters.teamId }, { responsibleTeamId: null, picAccount: { teamId: filters.teamId } }] });
  const [clients, revenue] = await Promise.all([
    db.client.findMany({
      where: conditions.length ? { AND: conditions } : {},
      include: { picAccount: { select: picSelect }, responsibleTeam: { select: { id: true, name: true } }, _count: { select: { clientBuyingUnits: { where: { active: true } }, clientOpportunities: { where: { outcome: null } }, clientExpectedEvents: { where: { status: "ACTIVE" } } } } },
    }),
    loadClientRevenue24m(db, now),
  ]);
  const clientIds = clients.map((client) => client.id);
  const [tasks, touchpoints] = clientIds.length ? await Promise.all([
    // One batched row per owner supplies the task details for each owner's minimum due date.
    db.task.findMany({
      where: { status: OPEN_TASK_STATUS_FILTER, OR: [{ clientId: { in: clientIds } }, { opportunity: { clientId: { in: clientIds }, outcome: null } }] },
      select: { id: true, title: true, dueDate: true, clientId: true, opportunityId: true, opportunity: { select: { clientId: true, name: true } }, assignee: { select: { id: true, name: true } } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
      distinct: ["clientId", "opportunityId"],
    }),
    db.touchpoint.findMany({
      where: { clientId: { in: clientIds }, status: "CONFIRMED" },
      select: { id: true, clientId: true, occurredAt: true, outcomeLevel: true, kind: true },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], distinct: ["clientId"],
    }),
  ]) : [[], []];
  const nextSteps = new Map<string, typeof tasks[number]>();
  for (const task of tasks) {
    const clientId = task.clientId ?? task.opportunity?.clientId;
    if (clientId && !nextSteps.has(clientId)) nextSteps.set(clientId, task);
  }
  const lastTouchpoints = new Map(touchpoints.map((touchpoint) => [touchpoint.clientId, touchpoint]));
  const percentiles = revenuePercentiles(revenue);
  const today = vnDayStart(now);
  const allRows = clients.map((client) => {
    const nextStep = nextSteps.get(client.id) ?? null;
    return {
      ...client,
      ...tierDetails(client.id, client.potentialLevel, revenue, percentiles, settings),
      nextStep,
      lastTouchpoint: lastTouchpoints.get(client.id) ?? null,
      overdue: !!nextStep?.dueDate && nextStep.dueDate < today,
      buyingUnitCount: client._count.clientBuyingUnits,
      openOpportunityCount: client._count.clientOpportunities,
      activeEventCount: client._count.clientExpectedEvents,
      team: client.responsibleTeam ?? client.picAccount?.team ?? null,
    };
  });
  const rows = allRows.filter((client) => {
    if (filters.tier && client.tier !== filters.tier) return false;
    switch (filters.status) {
      case "OVERDUE": return client.overdue;
      case "NO_NEXT_STEP": return !client.nextStep;
      case "ON_TRACK": return !!client.nextStep && !client.overdue;
      case "PENDING_PIC_CONFIRM": return client.importStatus === "PENDING_PIC_CONFIRM";
      default: return true;
    }
  }).sort((a, b) => Number(!!a.nextStep) - Number(!!b.nextStep) || (a.nextStep?.dueDate?.getTime() ?? Infinity) - (b.nextStep?.dueDate?.getTime() ?? Infinity) || a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id));
  const skip = Number.isSafeInteger(filters.skip) ? Math.max(0, filters.skip!) : 0;
  const take = Number.isSafeInteger(filters.take) ? Math.max(1, filters.take!) : CLIENT_PAGE_SIZE;
  return { rows: rows.slice(skip, skip + take), total: rows.length, inCareCount: allRows.filter((client) => client.picAccountId || client.openOpportunityCount || client.activeEventCount || client.importStatus).length, hasMore: skip + take < rows.length };
}

export async function loadClientProfile(db: Db, clientId: string, settings: CrmSettings, now: Date) {
  const [client, revenue] = await Promise.all([
    db.client.findUnique({
      where: { id: clientId },
      include: {
        picAccount: { select: picSelect }, responsibleTeam: { select: { id: true, name: true } }, potentialScoredBy: { select: { id: true, name: true } },
        clientBuyingUnits: { orderBy: { name: "asc" }, include: { opportunityBuyingUnit: { where: { outcome: "WON" }, select: { programTypeCode: true, programType: { select: { label: true } } } } } },
        clientOpportunities: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { project: { select: { id: true, name: true } }, buyingUnit: { select: { id: true, name: true } }, programType: { select: { label: true, color: true } }, outcomeReason: { select: { label: true } }, taskOpportunity: { where: { status: OPEN_TASK_STATUS_FILTER }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }], take: 1, select: { id: true, title: true, dueDate: true } } } },
        taskClient: { orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], include: { assignee: { select: { id: true, name: true, avatarUrl: true } }, creator: { select: { id: true, name: true } }, _count: { select: { comments: true, files: true } } } },
        clientTouchpoints: { orderBy: [{ occurredAt: "desc" }, { id: "desc" }], include: { author: { select: { id: true, name: true } }, opportunity: { select: { id: true, name: true } } } },
        clientExpectedEvents: { orderBy: [{ year: "asc" }, { month: "asc" }], include: { buyingUnit: { select: { id: true, name: true } }, programType: { select: { label: true, color: true } }, expectedEventSteps: { orderBy: { dueDate: "asc" } } } },
        clientPotentialScores: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        projects: { where: { category: "CLIENT", onProcessAt: { not: null } }, select: { id: true, name: true, type: true, executionStartAt: true, revenue: true, status: true, onProcessAt: true } },
      },
    }),
    loadClientRevenue24m(db, now),
  ]);
  if (!client) return null;
  const opportunities = client.clientOpportunities.map((opportunity) => ({ ...opportunity, budgetMin: opportunity.budgetMin === null ? null : Number(opportunity.budgetMin), budgetMax: opportunity.budgetMax === null ? null : Number(opportunity.budgetMax), contractValue: opportunity.contractValue === null ? null : Number(opportunity.contractValue), nextStep: opportunity.taskOpportunity[0] ?? null }));
  const closedOpportunities = opportunities.filter((opportunity) => opportunity.outcome !== null);
  return {
    ...client,
    ...tierDetails(client.id, client.potentialLevel, revenue, revenuePercentiles(revenue), settings),
    clientOpportunities: opportunities,
    team: client.responsibleTeam ?? client.picAccount?.team ?? null,
    buyingUnits: client.clientBuyingUnits,
    opportunities: [...opportunities.filter((opportunity) => opportunity.outcome === null), ...closedOpportunities],
    tasks: client.taskClient,
    touchpoints: client.clientTouchpoints.map((touchpoint) => ({ ...touchpoint, draft: touchpoint.status === "DRAFT" })),
    expectedEvents: client.clientExpectedEvents,
    potentialScores: client.clientPotentialScores,
    persona: computePersona({ projects: client.projects.map((project) => ({ ...project, won: true })), closedOpportunities: closedOpportunities.map((opportunity) => ({ outcome: opportunity.outcome!, reasonLabel: opportunity.outcomeReason?.label ?? null })) }),
  };
}

export type ClientListData = Awaited<ReturnType<typeof loadClientList>>;
export type ClientProfileData = NonNullable<Awaited<ReturnType<typeof loadClientProfile>>>;
