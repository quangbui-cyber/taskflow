import type { Prisma, PrismaClient } from "@prisma/client";
import { KPI_RECOGNIZED_STATUSES } from "../kpi";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { vnDateKey, vnDayStart } from "./dates";
import { computePersona } from "./persona";
import { assessPersonaDepth } from "./personaDepth";
import type { CrmSettings } from "./settings";
import type { TierValue } from "./settingsSchema";
import { cadenceWeeksFor, computeTier, revenue24mWindow, revenueBandFor, revenuePercentiles } from "./tier";
import { computeClientLifecycle, computeClientMetrics, type ClientLifecycle } from "./clientLifecycle";
import { storedFileDriveUrl } from "../storedFileResponse";

type Db = PrismaClient | Prisma.TransactionClient;
export const CLIENT_PAGE_SIZE = 50;
export type ClientListFilters = {
  q?: string;
  tier?: TierValue;
  picAccountId?: string;
  teamId?: string;
  status?: "OVERDUE" | "NO_NEXT_STEP" | "ON_TRACK" | "PENDING_PIC_CONFIRM";
  /** crm50: computed lifecycle; archived clients are hidden unless this is ARCHIVED or includeArchived is set. */
  lifecycle?: ClientLifecycle;
  tagId?: string;
  includeArchived?: boolean;
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
  if (filters.q?.trim()) {
    const q = filters.q.trim().slice(0, 200);
    const digits = q.replace(/\s+/g, "");
    conditions.push({ OR: [
      { name: { contains: q, mode: "insensitive" } },
      { shortName: { contains: q, mode: "insensitive" } },
      { legalName: { contains: q, mode: "insensitive" } },
      { clientAliases: { some: { name: { contains: q, mode: "insensitive" } } } },
      ...(/^[\d-]{3,14}$/.test(digits) ? [{ taxCode: { contains: digits } }] : []),
    ] });
  }
  if (filters.lifecycle === "ARCHIVED") conditions.push({ archivedAt: { not: null } });
  else if (!filters.includeArchived) conditions.push({ archivedAt: null });
  if (filters.tagId) conditions.push({ clientTagLinks: { some: { tagId: filters.tagId } } });
  if (filters.picAccountId) conditions.push({ picAccountId: filters.picAccountId });
  if (filters.teamId) conditions.push({ OR: [{ responsibleTeamId: filters.teamId }, { responsibleTeamId: null, picAccount: { teamId: filters.teamId } }] });
  const [clients, revenue] = await Promise.all([
    db.client.findMany({
      where: conditions.length ? { AND: conditions } : {},
      include: { picAccount: { select: picSelect }, responsibleTeam: { select: { id: true, name: true } }, clientTagLinks: { select: { tag: { select: { id: true, label: true } } }, orderBy: { tag: { label: "asc" } } }, _count: { select: { clientBuyingUnits: { where: { active: true } }, clientOpportunities: { where: { outcome: null } }, clientExpectedEvents: { where: { status: "ACTIVE" } } } } },
    }),
    loadClientRevenue24m(db, now),
  ]);
  const clientIds = clients.map((client) => client.id);
  const [tasks, touchpoints, lifecycleProjects] = clientIds.length ? await Promise.all([
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
    // Same recognized Project set as loadClientRevenue24m, without the window, for the computed lifecycle.
    db.project.findMany({ where: { category: "CLIENT", clientId: { in: clientIds }, status: { in: KPI_RECOGNIZED_STATUSES }, onProcessAt: { not: null } }, select: { clientId: true, status: true, onProcessAt: true } }),
  ]) : [[], [], []];
  const projectsByClient = new Map<string, { status: string; onProcessAt: Date | null }[]>();
  for (const project of lifecycleProjects) if (project.clientId) projectsByClient.set(project.clientId, [...(projectsByClient.get(project.clientId) ?? []), project]);
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
      lifecycle: computeClientLifecycle({ archivedAt: client.archivedAt, projects: projectsByClient.get(client.id) ?? [], now }),
      tags: client.clientTagLinks.map((link) => link.tag),
      overdue: !!nextStep?.dueDate && nextStep.dueDate < today,
      buyingUnitCount: client._count.clientBuyingUnits,
      openOpportunityCount: client._count.clientOpportunities,
      activeEventCount: client._count.clientExpectedEvents,
      team: client.responsibleTeam ?? client.picAccount?.team ?? null,
    };
  });
  const statusOk = (client: typeof allRows[number]) => {
    switch (filters.status) {
      case "OVERDUE": return client.overdue;
      case "NO_NEXT_STEP": return !client.nextStep;
      case "ON_TRACK": return !!client.nextStep && !client.overdue;
      case "PENDING_PIC_CONFIRM": return client.importStatus === "PENDING_PIC_CONFIRM";
      default: return true;
    }
  };
  const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id);
  // crm51 map view: tier x lifecycle under every filter except tier and lifecycle, so a selected cell keeps its context.
  const matrix = clientPortfolioMatrix(allRows.filter(statusOk).sort(byName));
  const rows = allRows.filter((client) => {
    if (filters.tier && client.tier !== filters.tier) return false;
    if (filters.lifecycle && client.lifecycle !== filters.lifecycle) return false;
    return statusOk(client);
  }).sort((a, b) => Number(!!a.nextStep) - Number(!!b.nextStep) || (a.nextStep?.dueDate?.getTime() ?? Infinity) - (b.nextStep?.dueDate?.getTime() ?? Infinity) || a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id));
  const skip = Number.isSafeInteger(filters.skip) ? Math.max(0, filters.skip!) : 0;
  const take = Number.isSafeInteger(filters.take) ? Math.max(1, filters.take!) : CLIENT_PAGE_SIZE;
  return { rows: rows.slice(skip, skip + take), total: rows.length, inCareCount: rows.filter((client) => client.picAccountId || client.openOpportunityCount || client.activeEventCount || client.importStatus).length, overdueCount: rows.filter((client) => client.overdue).length, hasMore: skip + take < rows.length, matrix };
}

export const MATRIX_TIERS: TierValue[] = ["S", "A", "B", "C", "UNRATED"];
export const MATRIX_LIFECYCLES: ClientLifecycle[] = ["PROSPECT", "ACTIVE", "DORMANT", "ARCHIVED"];
export const MATRIX_CELL_PREVIEW = 6;
/** Pure: counts and the first few clients (already sorted) per tier and lifecycle cell. */
export function clientPortfolioMatrix(clients: { id: string; name: string; tier: TierValue; lifecycle: ClientLifecycle; overdue: boolean }[]) {
  const cells = new Map<string, { count: number; overdue: number; preview: { id: string; name: string; overdue: boolean }[] }>();
  for (const tier of MATRIX_TIERS) for (const lifecycle of MATRIX_LIFECYCLES) cells.set(`${tier}|${lifecycle}`, { count: 0, overdue: 0, preview: [] });
  for (const c of clients) {
    const cell = cells.get(`${c.tier}|${c.lifecycle}`);
    if (!cell) continue;
    cell.count++; if (c.overdue) cell.overdue++;
    if (cell.preview.length < MATRIX_CELL_PREVIEW) cell.preview.push({ id: c.id, name: c.name, overdue: c.overdue });
  }
  return MATRIX_TIERS.map((tier) => ({ tier, cells: MATRIX_LIFECYCLES.map((lifecycle) => ({ lifecycle, ...cells.get(`${tier}|${lifecycle}`)! })) }));
}
export type ClientPortfolioMatrixData = ReturnType<typeof clientPortfolioMatrix>;

export type ClientCardExtras = { months: { month: number; level: 0 | 1 | 2; title: string | null }[]; seasonLabel: string | null; touches: (number | null)[] };
/** crm51 cards: one batched query each for touches, projects and expected events of the visible page (no N+1). */
export async function loadClientCardExtras(db: Db, clientIds: string[], now: Date): Promise<Map<string, ClientCardExtras>> {
  const result = new Map<string, ClientCardExtras>();
  if (!clientIds.length) return result;
  const range = revenue24mWindow(now);
  const year = Number(vnDateKey(now).slice(0, 4));
  const [touches, projects, events] = await Promise.all([
    db.touchpoint.findMany({ where: { clientId: { in: clientIds }, status: "CONFIRMED", occurredAt: { gte: range.start } }, select: { clientId: true, outcomeLevel: true }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }] }),
    db.project.findMany({ where: { clientId: { in: clientIds }, category: "CLIENT", status: { in: KPI_RECOGNIZED_STATUSES }, OR: [{ executionStartAt: { gte: range.start, lt: range.end } }, { executionStartAt: null, onProcessAt: { gte: range.start, lt: range.end } }] }, select: { clientId: true, executionStartAt: true, onProcessAt: true } }),
    db.expectedEvent.findMany({ where: { clientId: { in: clientIds }, status: { in: ["ACTIVE", "BRIEF_RECEIVED"] }, year: { gte: year - 1 } }, select: { clientId: true, precision: true, month: true, quarter: true, date: true, programType: { select: { label: true } } } }),
  ]);
  const get = (id: string) => {
    let row = result.get(id);
    if (!row) { row = { months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, level: 0 as 0 | 1 | 2, title: null as string | null })), seasonLabel: null, touches: [] }; result.set(id, row); }
    return row;
  };
  for (const id of clientIds) get(id);
  for (const t of touches) { const row = get(t.clientId); if (row.touches.length < 4) row.touches.push(t.outcomeLevel); }
  for (const p of projects) {
    const date = p.executionStartAt ?? p.onProcessAt;
    if (!p.clientId || !date) continue;
    const m = get(p.clientId).months[Number(vnDateKey(date).slice(5, 7)) - 1];
    m.level = 2; m.title = "Đã làm với CS";
  }
  for (const e of events) {
    const month = e.precision === "QUARTER" && e.quarter ? (e.quarter - 1) * 3 + 1 : e.precision === "DAY" && e.date ? Number(vnDateKey(e.date).slice(5, 7)) : e.month;
    if (!month || month < 1 || month > 12) continue;
    const row = get(e.clientId); const m = row.months[month - 1];
    if (m.level < 1) { m.level = 1; m.title = `Dự kiến: ${e.programType.label}`; }
    if (!row.seasonLabel) row.seasonLabel = `${e.programType.label} dự kiến T${month}`;
  }
  for (const row of result.values()) if (!row.seasonLabel) {
    const done = row.months.filter((m) => m.level === 2).map((m) => m.month);
    row.seasonLabel = done.length ? `Thường làm ${done.slice(0, 3).map((m) => `T${m}`).join(", ")}` : null;
  }
  return result;
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
        parentClient: { select: { id: true, name: true, archivedAt: true } },
        childClients: { orderBy: { name: "asc" }, select: { id: true, name: true, archivedAt: true, childClients: { select: { id: true } } } },
        clientAliases: { orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } },
        clientTagLinks: { orderBy: { tag: { label: "asc" } }, select: { tag: { select: { id: true, label: true, active: true } } } },
        clientCompetitors: { orderBy: { competitor: { name: "asc" } }, select: { id: true, note: true, since: true, competitor: { select: { id: true, name: true, active: true } } } },
        clientFieldChanges: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 },
        archivedBy: { select: { id: true, name: true } },
      },
    }),
    loadClientRevenue24m(db, now),
  ]);
  if (!client) return null;
  // Parent pages add up their child companies (max 3 levels); tier stays per legal entity.
  const descendantIds = [...client.childClients.map((child) => child.id), ...client.childClients.flatMap((child) => child.childClients.map((grand) => grand.id))];
  const groupIds = [client.id, ...descendantIds];
  const opportunityIds = client.clientOpportunities.map((opportunity) => opportunity.id);
  const [groupProjects, groupOpportunities, groupTouch, projectList, files, meetings] = await Promise.all([
    db.project.findMany({ where: { category: "CLIENT", clientId: { in: groupIds }, onProcessAt: { not: null } }, select: { status: true, onProcessAt: true, revenue: true } }),
    db.opportunity.findMany({ where: { clientId: { in: groupIds } }, select: { outcome: true, contractValue: true } }),
    db.touchpoint.findFirst({ where: { clientId: { in: groupIds }, status: "CONFIRMED" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], select: { occurredAt: true } }),
    db.project.findMany({ where: { clientId: client.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, name: true, status: true, type: true, onProcessAt: true, executionStartAt: true, sourceOpportunityId: true } }),
    db.projectFile.findMany({ where: { OR: [{ clientId: client.id }, { opportunityId: { in: opportunityIds } }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200, select: { id: true, name: true, mimeType: true, size: true, createdAt: true, driveFileId: true, opportunityId: true, opportunity: { select: { id: true, name: true } }, uploader: { select: { id: true, name: true } } } }),
    db.meeting.findMany({ where: { OR: [{ clientId: client.id }, { opportunityId: { in: opportunityIds } }] }, orderBy: [{ startAt: "desc" }, { id: "desc" }], take: 200, select: { id: true, title: true, startAt: true, status: true, opportunity: { select: { id: true, name: true } } } }),
  ]);
  const opportunities = client.clientOpportunities.map((opportunity) => ({ ...opportunity, budgetMin: opportunity.budgetMin === null ? null : Number(opportunity.budgetMin), budgetMax: opportunity.budgetMax === null ? null : Number(opportunity.budgetMax), contractValue: opportunity.contractValue === null ? null : Number(opportunity.contractValue), nextStep: opportunity.taskOpportunity[0] ?? null }));
  const closedOpportunities = opportunities.filter((opportunity) => opportunity.outcome !== null);
  const tier = tierDetails(client.id, client.potentialLevel, revenue, revenuePercentiles(revenue), settings);
  return {
    ...client,
    ...tier,
    clientOpportunities: opportunities,
    team: client.responsibleTeam ?? client.picAccount?.team ?? null,
    buyingUnits: client.clientBuyingUnits,
    opportunities: [...opportunities.filter((opportunity) => opportunity.outcome === null), ...closedOpportunities],
    tasks: client.taskClient,
    touchpoints: client.clientTouchpoints.map((touchpoint) => ({ ...touchpoint, draft: touchpoint.status === "DRAFT" })),
    expectedEvents: client.clientExpectedEvents,
    potentialScores: client.clientPotentialScores,
    persona: computePersona({ projects: client.projects.map((project) => ({ ...project, won: true })), closedOpportunities: closedOpportunities.map((opportunity) => ({ outcome: opportunity.outcome!, reasonLabel: opportunity.outcomeReason?.label ?? null })) }),
    personaDepth: assessPersonaDepth(settings.personaDepth, tier.tier, client),
    lifecycle: computeClientLifecycle({ archivedAt: client.archivedAt, projects: client.projects, now }),
    metrics: computeClientMetrics({ projects: groupProjects, opportunities: groupOpportunities.map((o) => ({ outcome: o.outcome, contractValue: o.contractValue === null ? null : Number(o.contractValue) })), lastConfirmedTouchAt: groupTouch?.occurredAt ?? null }),
    metricsScope: descendantIds.length ? { kind: "GROUP" as const, childCount: descendantIds.length } : { kind: "OWN" as const, childCount: 0 },
    aliases: client.clientAliases,
    tags: client.clientTagLinks.map((link) => link.tag),
    competitors: client.clientCompetitors,
    fieldChanges: client.clientFieldChanges,
    projectList,
    files: files.map((file) => ({ ...file, driveUrl: storedFileDriveUrl(file), href: file.opportunityId ? `/api/crm/opportunities/${file.opportunityId}/files/${file.id}` : null })),
    meetings,
  };
}

export type ClientListData = Awaited<ReturnType<typeof loadClientList>>;
export type ClientProfileData = NonNullable<Awaited<ReturnType<typeof loadClientProfile>>>;
