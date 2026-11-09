import type { Prisma, PrismaClient } from "@prisma/client";
import { KPI_RECOGNIZED_STATUSES } from "../kpi";
import { loadProgramTypes } from "../programTypes";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { vnDayStart } from "./dates";
import { competitiveWinRate, outsideWinRate, pipelineByStage, nextStepCoverage, careToBrief, touchQuality } from "./metrics";
import type { PipelineModeSetting } from "./pipelineMode";
import { endReasonTables, isNewClient, parsePipelineFilters, pipelineScope, qualityBars, resolvePipelinePeriod, usageSummary, type PipelineFilters } from "./pipelineReport";

type Db = PrismaClient | Prisma.TransactionClient;
/** Company report, independent of viewer edit permissions. Projects only classify clients. */
export async function loadPipelineReport(db: Db, input: PipelineFilters, setting: PipelineModeSetting, now: Date) {
  const period = resolvePipelinePeriod(input.period, now);
  const baseScope = pipelineScope(setting, null);
  const [teams, programTypes, firstWins, recognized] = await Promise.all([
    db.salesTeam.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    loadProgramTypes(db),
    input.client === "ALL" ? Promise.resolve([]) : db.opportunity.groupBy({ by: ["clientId"], where: { outcome: "WON", closedAt: { not: null } }, _min: { closedAt: true } }),
    input.client === "ALL" ? Promise.resolve([]) : db.project.findMany({ where: { category: "CLIENT", status: { in: KPI_RECOGNIZED_STATUSES }, clientId: { not: null }, onProcessAt: { not: null } }, select: { clientId: true, onProcessAt: true } }),
  ]);
  // Unknown ids normalize to defaults; a real team outside the pilot stays an empty scope.
  const filters = parsePipelineFilters({ period: input.period, client: input.client, team: teams.some(t => t.id === input.teamId) ? input.teamId : undefined, program: programTypes.some(p => p.code === input.programTypeCode) ? input.programTypeCode : undefined, source: input.source });
  const scope = pipelineScope(setting, filters.teamId);
  const teamIds = scope.teamIds;
  const clientTeam: Prisma.ClientWhereInput = teamIds === null ? {} : { OR: [
    { responsibleTeamId: { in: teamIds } },
    { responsibleTeamId: null, picAccount: { teamId: { in: teamIds } } },
  ] };
  const opportunityTeam: Prisma.OpportunityWhereInput = teamIds === null ? {} : { OR: [
    { responsibleTeamId: { in: teamIds } },
    { responsibleTeamId: null, picAccount: { teamId: { in: teamIds } } },
    { responsibleTeamId: null, picAccountId: null, client: clientTeam },
  ] };
  const firstWinAt = new Map<string, Date>();
  function addWin(id: string | null, date: Date | null) {
    if (id && date && (!firstWinAt.has(id) || date < firstWinAt.get(id)!)) firstWinAt.set(id, date);
  }
  for (const row of firstWins) addWin(row.clientId, row._min.closedAt);
  for (const row of recognized) addWin(row.clientId, row.onProcessAt);
  const existingIds = [...firstWinAt].filter(([, date]) => !isNewClient(date, period.start)).map(([id]) => id);
  const segment: Prisma.ClientWhereInput = filters.client === "NEW" ? { id: { notIn: existingIds } } : filters.client === "EXISTING" ? { id: { in: existingIds } } : {};
  const catalog: Prisma.OpportunityWhereInput = { ...(filters.programTypeCode ? { programTypeCode: filters.programTypeCode } : {}), ...(filters.source ? { source: filters.source } : {}) };
  const opportunityWhere: Prisma.OpportunityWhereInput = { AND: [opportunityTeam, catalog, { client: segment }] };
  const clientWhere: Prisma.ClientWhereInput = { AND: [clientTeam, segment, ...(filters.programTypeCode || filters.source ? [{ clientOpportunities: { some: { AND: [opportunityTeam, catalog] } } }] : [])] };
  // Opportunity-owned work follows its own team, not the Client's current PIC/team.
  const taskWhere: Prisma.TaskWhereInput = { OR: [{ clientId: { not: null }, client: clientWhere }, { opportunityId: { not: null }, opportunity: opportunityWhere }] };
  const touchWhere: Prisma.TouchpointWhereInput = { OR: [{ opportunityId: null, client: clientWhere }, { opportunity: opportunityWhere }] };
  const inPeriod = { gte: period.start, lt: period.end };
  const today = vnDayStart(now);
  const [closed, created, open, clients, touches, drafts, overdueTasks] = await Promise.all([
    db.opportunity.findMany({ where: { AND: [opportunityWhere, { outcome: { not: null }, closedAt: inPeriod }] }, select: { id: true, clientId: true, outcome: true, closedAt: true, programTypeCode: true, outcomeReason: { select: { label: true } } } }),
    db.opportunity.findMany({ where: { AND: [opportunityWhere, { createdAt: inPeriod }] }, select: { briefReceivedAt: true, stage: true, outcome: true } }),
    db.opportunity.findMany({ where: { AND: [opportunityWhere, { outcome: null }] }, select: { stage: true, budgetMin: true, budgetMax: true, taskOpportunity: { where: { status: OPEN_TASK_STATUS_FILTER, dueDate: { lt: today } }, take: 1, select: { id: true } } } }),
    db.client.findMany({ where: { AND: [clientWhere, { picAccountId: { not: null } }] }, select: { id: true, taskClient: { where: { status: OPEN_TASK_STATUS_FILTER }, take: 1, select: { id: true } }, clientOpportunities: { where: { AND: [opportunityWhere, { outcome: null, taskOpportunity: { some: { status: OPEN_TASK_STATUS_FILTER } } }] }, take: 1, select: { id: true } } } }),
    db.touchpoint.findMany({ where: { AND: [touchWhere, { status: "CONFIRMED", occurredAt: inPeriod }] }, select: { clientId: true, outcomeLevel: true, status: true } }),
    db.touchpoint.findMany({ where: { AND: [touchWhere, { status: "DRAFT" }] }, select: { createdAt: true } }),
    db.task.count({ where: { AND: [taskWhere, { status: OPEN_TASK_STATUS_FILTER, dueDate: { lt: today } }] } }),
  ]);
  const closedIds = closed.map(r => r.id), closedClientIds = [...new Set(closed.map(r => r.clientId))];
  const [winbackTasks, laterBriefs] = closed.length ? await Promise.all([
    db.task.findMany({ where: { crmKind: "WINBACK", sourceOpportunityId: { in: closedIds } }, select: { sourceOpportunityId: true } }),
    db.opportunity.findMany({ where: { AND: [opportunityWhere, { clientId: { in: closedClientIds }, briefReceivedAt: { not: null }, createdAt: { gt: closed.reduce((min, r) => r.closedAt! < min ? r.closedAt! : min, period.end), lte: now } }] }, select: { clientId: true, createdAt: true, briefReceivedAt: true } }),
  ]) : [[], []];
  const winbackIds = new Set(winbackTasks.map(r => r.sourceOpportunityId));
  const latestBrief = new Map<string, number>();
  for (const row of laterBriefs) if (row.briefReceivedAt! <= now) latestBrief.set(row.clientId, Math.max(latestBrief.get(row.clientId) ?? 0, row.createdAt.getTime()));
  return {
    period, scope, filters,
    tiles: {
      coverage: nextStepCoverage(clients.map(c => ({ inCare: true, hasOpenNextStep: c.taskClient.length > 0 || c.clientOpportunities.length > 0 }))),
      careToBrief: careToBrief(created.map(o => ({ outcome: o.outcome, reachedBrief: o.briefReceivedAt !== null || ["BRIEF", "BIDDING"].includes(o.stage) || ["WON", "LOST_COMPETITIVE"].includes(o.outcome ?? "") }))),
      winRate: competitiveWinRate(closed), outside: outsideWinRate([...closed, ...open.map(() => ({ outcome: null }))]),
    },
    openPipeline: pipelineByStage(open.map(o => ({ stage: o.stage, budgetMin: o.budgetMin === null ? null : Number(o.budgetMin), budgetMax: o.budgetMax === null ? null : Number(o.budgetMax), hasOverdueNextStep: o.taskOpportunity.length > 0 }))),
    quality: qualityBars(touchQuality(touches)),
    endReasons: endReasonTables(closed.map(o => ({ outcome: o.outcome, reasonLabel: o.outcomeReason?.label ?? null, programTypeCode: o.programTypeCode, hasWinback: winbackIds.has(o.id), becameNewBrief: (latestBrief.get(o.clientId) ?? 0) > o.closedAt!.getTime() }))),
    usage: usageSummary({ overdueTasks, drafts, touchpoints: touches.length, now }),
    options: { teams: baseScope.teamIds === null ? teams : teams.filter(t => baseScope.teamIds!.includes(t.id)), programTypes },
    isEmpty: closed.length === 0 && created.length === 0 && open.length === 0,
  };
}
export type PipelineReportData = Awaited<ReturnType<typeof loadPipelineReport>>;
