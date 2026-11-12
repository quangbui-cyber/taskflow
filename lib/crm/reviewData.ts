import type { ReviewItem, ReviewGroup } from "./review";
import type { Prisma, PrismaClient } from "@prisma/client";
import * as review from "./review";
import type { TierValue, CadenceWeeks } from "./settingsSchema";
import { REVIEW_REASON_LABELS, EVENT_SOURCES, TOUCHPOINT_KINDS, OUTCOME_LEVELS } from "./labels";
import { vnDateKey, vnDayStart, vnDayStartFromKey, addDaysVn, crmWeekRange, formatCrmWeekLabel } from "./dates";
import { eventTimingLabel } from "./seasonGrid";
import { vietnamYearMonth } from "../kpi";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { crmCan, type CrmActor, type CrmOwnerResource } from "./policy";
import { getCrmSettings } from "./settings";
import { loadClientRevenue24m } from "./clientData";
import { computeTier, revenuePercentiles, revenueBandFor } from "./tier";

export type ReviewRawFilters = { team?: string | string[]; pic?: string | string[] };
export type ReviewFilters = { teamId: string | null; pic: "all" | "me" | string; key: string };
export function resolveReviewFilters(raw: ReviewRawFilters, ctx: { managedTeamIds: string[]; accountTeamId: string | null; accountId: string | null; teamIds: string[]; picAccountIds?: string[] }): ReviewFilters {
  const valid = (v: unknown): string | undefined => typeof v === "string" && v.length <= 64 ? v : undefined;
  const team = valid(raw.team); const pic = valid(raw.pic);
  const fallback = ctx.accountTeamId && ctx.teamIds.includes(ctx.accountTeamId) ? ctx.accountTeamId : ctx.managedTeamIds.find((id) => ctx.teamIds.includes(id)) ?? null;
  const teamId = team === "all" ? null : team && ctx.teamIds.includes(team) ? team : fallback;
  const selectedPic = pic === "me" ? ctx.accountId ? "me" : "all" : pic && ctx.picAccountIds?.includes(pic) ? pic : "all";
  return { teamId, pic: selectedPic, key: `${teamId ?? "all"}|${selectedPic}` };
}

export function clientInCare(c: { picAccountId: string | null; openOpportunityCount: number; activeEventCount: number; importStatus: string | null }): boolean {
  return c.picAccountId !== null || c.openOpportunityCount > 0 || c.activeEventCount > 0 || c.importStatus !== null;
}
type ReviewTask = { id: string; dueDate: Date | null; crmKind: string | null; escalatedAt: Date | null };
export function reviewReasonFor(task: Pick<ReviewTask, "crmKind" | "escalatedAt"> | null, planClose: boolean): keyof typeof REVIEW_REASON_LABELS {
  if (task?.escalatedAt) return "ESCALATED";
  if (!task) return planClose ? "PLAN_CLOSE" : "NEXT_STEP";
  return ["APPOINTMENT", "EVENT_REMINDER", "VERIFY_MONTH", "CADENCE", "WAIT", "NEXT_STEP", "CAMPAIGN"].includes(task.crmKind ?? "") ? task.crmKind as keyof typeof REVIEW_REASON_LABELS : "NEXT_STEP";
}
export function toReviewItem(input: { clientId: string; tier: TierValue; task: ReviewTask | null; budgetSeasonMonth: number | null }, now: Date): ReviewItem {
  const month = vietnamYearMonth(now).month;
  return { key: input.task?.id ?? `client:${input.clientId}`, clientId: input.clientId, tier: input.tier, dueDate: input.task?.dueDate ?? null, hasOpenNextStep: input.task !== null, appointment: input.task?.crmKind === "APPOINTMENT", planClose: input.budgetSeasonMonth === month || input.budgetSeasonMonth === month % 12 + 1, escalated: input.task?.escalatedAt != null };
}
export function reviewPrefill(input: { clientId: string; opportunityId: string | null; taskId: string | null; taskAssigneeId: string | null; picUserId: string | null; tier: TierValue; cadenceWeeks: CadenceWeeks }, now: Date): ReviewRow["prefill"] {
  return { clientId: input.clientId, opportunityId: input.opportunityId, completeTaskId: input.taskId, title: null, nextDueDate: vnDateKey(addDaysVn(vnDayStart(now), input.cadenceWeeks[input.tier] * 7)), assigneeId: input.taskAssigneeId ?? input.picUserId ?? null };
}

export type ReviewRow = {
  key: string; group: ReviewGroup;
  client: { id: string; name: string; version: number; tier: TierValue; buyingUnitName: string | null };
  reason: { key: keyof typeof REVIEW_REASON_LABELS; label: string; sourceLabel: string | null; sentence: string; lateDays: number | null };
  lastTouch: { date: Date; kindLabel: string; outcomeLabel: string | null } | null;
  opportunity: { id: string; name: string } | null;
  pic: { accountId: string; name: string; userId: string | null } | null;
  assignee: { id: string; name: string } | null; dueDate: Date | null; taskId: string | null;
  campaignTask?: boolean;
  prefill: { clientId: string; opportunityId: string | null; completeTaskId: string | null; title: string | null; nextDueDate: string | null; assigneeId: string | null };
  can: { logResult: boolean; assign: boolean; postpone: boolean; escalate: boolean; assignPic: boolean };
};
export type UnratedRow = { clientId: string; name: string; revenue24m: number; version: number };
export type DraftRow = { id: string; clientId: string; clientName: string; opportunityId: string | null; occurredAt: Date; sourceLabel: "Họp TaskFlow" | "Biên bản họp" | "Nhập tracker"; title: string; canConfirm: boolean };
export type WeeklyReviewGroups = { week: { mondayKey: string; label: string; start: Date; end: Date }; filters: ReviewFilters; metrics: { overdue: number; dueThisWeek: number; noNextStep: number }; groups: Record<ReviewGroup, ReviewRow[]>; isEmpty: boolean };
export type UpcomingEventRow = { id: string; clientId: string; clientName: string; programLabel: string; timingLabel: string; startsAt: Date };
export type WeeklyReview = WeeklyReviewGroups & { teams: { id: string; name: string }[]; pics: { accountId: string; name: string }[]; metrics: WeeklyReviewGroups["metrics"] & { drafts: number }; unrated: UnratedRow[]; potentialScaleConfigured: boolean; drafts: DraftRow[]; doneThisWeek: number; upcomingEvents: UpcomingEventRow[] };

const accountSelect = { id: true, name: true, userId: true, teamId: true } as const;
const clientSelect = {
  id: true, name: true, version: true, picAccountId: true, picAccount: { select: accountSelect }, responsibleTeamId: true,
  potentialLevel: true, budgetSeasonMonth: true, importStatus: true,
  clientBuyingUnits: { where: { active: true }, select: { id: true, name: true } },
  _count: { select: { clientOpportunities: { where: { outcome: null } }, clientExpectedEvents: { where: { status: "ACTIVE" } } } },
} as const satisfies Prisma.ClientSelect;
type ReviewClient = Prisma.ClientGetPayload<{ select: typeof clientSelect }>;
function clientResource(client: ReviewClient): CrmOwnerResource {
  return { kind: "CLIENT", picUserId: client.picAccount?.userId ?? null, teamId: client.responsibleTeamId ?? client.picAccount?.teamId ?? null };
}
function careScope(teamId: string | null): Prisma.ClientWhereInput {
  return { AND: [
    { archivedAt: null },
    { OR: [{ picAccountId: { not: null } }, { clientOpportunities: { some: { outcome: null } } }, { clientExpectedEvents: { some: { status: "ACTIVE" } } }, { importStatus: { not: null } }] },
    ...(teamId ? [{ OR: [{ responsibleTeamId: teamId }, { responsibleTeamId: null, picAccount: { teamId } }] }] : []),
  ] };
}

/** Both callers share all filter, task-selection, tier, permission and ordering rules. */
async function loadReviewCore(db: PrismaClient, actor: CrmActor, raw: ReviewRawFilters, now: Date, full: boolean) {
  const [teams, account] = await Promise.all([
    full ? db.salesTeam.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : db.salesTeam.findMany({ select: { id: true } }),
    actor.accountId ? db.account.findUnique({ where: { id: actor.accountId }, select: { teamId: true } }) : null,
  ]);
  const ctx = { managedTeamIds: actor.managedTeamIds, accountTeamId: account?.teamId ?? null, accountId: actor.accountId, teamIds: teams.map((t) => t.id) };
  const teamFilters = resolveReviewFilters(raw, ctx);
  // Campaign assignment belongs to the task/target, independently of the client's original PIC and team.
  const campaignLinks = await db.careCampaignTask.findMany({
    where: {
      task: { status: OPEN_TASK_STATUS_FILTER, crmKind: "CAMPAIGN", projectId: null, client: { archivedAt: null } },
      AND: [
        ...(actor.role === "ADMIN" ? [] : [{ OR: [
          { task: { assigneeId: actor.id } }, { target: { campaign: { teamId: { in: actor.managedTeamIds } } } },
        ] }]),
        ...(teamFilters.teamId ? [{ target: { OR: [
          { campaign: { teamId: teamFilters.teamId } },
          { campaign: { teamId: null }, picAccount: { teamId: teamFilters.teamId } },
        ] } }] : []),
      ],
    },
    select: { taskId: true, task: { select: { clientId: true } }, target: { select: { picAccountId: true, picAccount: { select: { id: true, name: true } } } } },
  });
  const picRows = full ? await db.client.findMany({ where: careScope(teamFilters.teamId), distinct: ["picAccountId"], select: { picAccount: { select: { id: true, name: true } } } }) : [];
  const pics = [...new Map([...picRows, ...campaignLinks.map((l) => l.target)].flatMap((c) => c.picAccount ? [[c.picAccount.id, { accountId: c.picAccount.id, name: c.picAccount.name }] as const] : [])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "vi") || a.accountId.localeCompare(b.accountId));
  const requestedPic = typeof raw.pic === "string" && raw.pic.length <= 64 && !["all", "me"].includes(raw.pic) ? raw.pic : null;
  const picAccountIds = full ? pics.map((p) => p.accountId) : requestedPic ? (await db.account.findMany({ where: { id: requestedPic }, select: { id: true } })).map((p) => p.id) : [];
  const filters = resolveReviewFilters(raw, { ...ctx, picAccountIds });
  const picScope = filters.pic === "me" ? { picAccountId: actor.accountId } : filters.pic !== "all" ? { picAccountId: filters.pic } : {};
  const campaignTasks = new Set(campaignLinks.filter((l) => filters.pic === "all" || l.target.picAccountId === (filters.pic === "me" ? actor.accountId : filters.pic)).map((l) => l.taskId));
  const campaignClientIds = [...new Set(campaignLinks.filter((l) => campaignTasks.has(l.taskId)).flatMap((l) => l.task.clientId ? [l.task.clientId] : []))];
  const [nativeClients, assignedClients] = await Promise.all([
    db.client.findMany({ where: { AND: [careScope(filters.teamId), picScope] }, select: clientSelect }),
    campaignClientIds.length ? db.client.findMany({ where: { id: { in: campaignClientIds }, archivedAt: null }, select: clientSelect }) : [],
  ]);
  const nativeIds = new Set(nativeClients.filter((c) => clientInCare({ picAccountId: c.picAccountId, openOpportunityCount: c._count.clientOpportunities, activeEventCount: c._count.clientExpectedEvents, importStatus: c.importStatus })).map((c) => c.id));
  const clients = [...new Map([...nativeClients.filter((c) => nativeIds.has(c.id)), ...assignedClients].map((c) => [c.id, c])).values()];
  const clientIds = clients.map((c) => c.id);
  const [tasks, touches, revenue, settings] = await Promise.all([
    db.task.findMany({
      where: { status: OPEN_TASK_STATUS_FILTER, OR: [{ clientId: { in: clientIds } }, { opportunity: { clientId: { in: clientIds }, outcome: null } }] },
      select: { id: true, title: true, clientId: true, opportunityId: true, dueDate: true, crmKind: true, escalatedAt: true, creatorId: true, assigneeId: true, assignee: { select: { id: true, name: true } }, opportunity: { select: { id: true, name: true, clientId: true, outcome: true, responsibleTeamId: true, picAccount: { select: accountSelect }, buyingUnit: { select: { name: true } } } }, reminderTask: { where: { status: { in: ["OPEN", "PLANNED"] } }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], select: { expectedEvent: { select: { source: true } } } }, careCampaignTask: { select: { target: { select: { campaign: { select: { name: true } } } } } } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
    }),
    db.touchpoint.findMany({ where: { clientId: { in: clientIds }, status: "CONFIRMED" }, select: { clientId: true, occurredAt: true, kind: true, outcomeLevel: true }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], distinct: ["clientId"] }),
    // Phân vị hạng dùng cùng tập doanh thu toàn công ty như hồ sơ khách, không đổi khi lọc PIC/team.
    loadClientRevenue24m(db, now), getCrmSettings(db),
  ]);
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const ownCampaignClients = new Set(tasks.filter((t) => campaignTasks.has(t.id) && t.assigneeId === actor.id).flatMap((t) => t.clientId ? [t.clientId] : []));
  const nextTasks = new Map<string, typeof tasks[number]>();
  for (const task of tasks) {
    const clientId = task.clientId ?? task.opportunity?.clientId;
    if (!clientId || (task.crmKind === "CAMPAIGN" ? !campaignTasks.has(task.id) : !nativeIds.has(clientId))) continue;
    if (task.crmKind !== "CAMPAIGN" && ownCampaignClients.has(clientId)) {
      const clientOwner = clientResource(clientById.get(clientId)!);
      const opp = task.opportunity;
      const owner: CrmOwnerResource = opp ? { kind: "OPPORTUNITY", picUserId: opp.picAccount?.userId ?? null, teamId: opp.responsibleTeamId ?? opp.picAccount?.teamId ?? clientOwner.teamId, closed: opp.outcome !== null } : clientOwner;
      if (!crmCan(actor, "LOG_TOUCHPOINT", { kind: "TASK", owner, assigneeId: task.assigneeId, creatorId: task.creatorId })) continue;
    }
    if (!nextTasks.has(clientId)) nextTasks.set(clientId, task);
  }
  const latest = new Map(touches.map((t) => [t.clientId, t]));
  const percentiles = revenuePercentiles(revenue);
  const tierByClient = new Map(clients.map((c) => {
    const band = revenueBandFor(percentiles.get(c.id) ?? null, settings.tierMatrix.revenueBands);
    return [c.id, computeTier({ potentialLevel: c.potentialLevel, revenueBand: band?.key ?? null, matrix: settings.tierMatrix, scale: settings.potentialScale })];
  }));
  const items = clients.map((c) => toReviewItem({ clientId: c.id, tier: tierByClient.get(c.id)!.tier, task: nextTasks.get(c.id) ?? null, budgetSeasonMonth: c.budgetSeasonMonth }, now));
  const grouped = review.buildReviewGroups(items, settings.reviewPriority, now);
  const groups = Object.fromEntries((Object.keys(grouped) as ReviewGroup[]).map((group) => [group, grouped[group].map((item): ReviewRow => {
    const client = clientById.get(item.clientId)!;
    const task = nextTasks.get(client.id) ?? null; const opp = task?.opportunity ?? null;
    const clientOwner = clientResource(client);
    const owner: CrmOwnerResource = opp ? { kind: "OPPORTUNITY", picUserId: opp.picAccount?.userId ?? null, teamId: opp.responsibleTeamId ?? opp.picAccount?.teamId ?? clientOwner.teamId, closed: opp.outcome !== null } : clientOwner;
    const taskOwner = task ? { kind: "TASK" as const, owner, assigneeId: task.assigneeId, creatorId: task.creatorId } : null;
    const reasonKey = reviewReasonFor(task, item.planClose);
    const source = ["EVENT_REMINDER", "VERIFY_MONTH"].includes(task?.crmKind ?? "") ? task?.reminderTask[0]?.expectedEvent.source : null;
    const touch = latest.get(client.id);
    return {
      key: item.key, group,
      client: { id: client.id, name: client.name, version: client.version, tier: item.tier, buyingUnitName: opp?.buyingUnit?.name ?? null },
      reason: { key: reasonKey, label: reasonKey === "CAMPAIGN" && task?.careCampaignTask ? `Chiến dịch ${task.careCampaignTask.target.campaign.name}` : REVIEW_REASON_LABELS[reasonKey], sourceLabel: EVENT_SOURCES.find((s) => s.key === source)?.label ?? null, sentence: task?.title ?? "Chưa có bước tiếp theo", lateDays: group === "OVERDUE" && task?.dueDate ? Math.floor((vnDayStart(now).getTime() - vnDayStart(task.dueDate).getTime()) / 86400000) : null },
      lastTouch: touch ? { date: touch.occurredAt, kindLabel: TOUCHPOINT_KINDS.find((k) => k.key === touch.kind)?.label ?? touch.kind, outcomeLabel: OUTCOME_LEVELS.find((level) => level.key === touch.outcomeLevel)?.label ?? null } : null,
      opportunity: opp ? { id: opp.id, name: opp.name } : null,
      pic: client.picAccount ? { accountId: client.picAccount.id, name: client.picAccount.name, userId: client.picAccount.userId } : null,
      assignee: task?.assignee ?? null, dueDate: task?.dueDate ?? null, taskId: task?.id ?? null,
      campaignTask: task?.crmKind === "CAMPAIGN",
      prefill: reviewPrefill({ clientId: client.id, opportunityId: opp?.id ?? null, taskId: task?.id ?? null, taskAssigneeId: task?.assigneeId ?? null, picUserId: client.picAccount?.userId ?? null, tier: item.tier, cadenceWeeks: settings.cadenceWeeks }, now),
      can: { logResult: crmCan(actor, "LOG_TOUCHPOINT", owner) || !!taskOwner && crmCan(actor, "LOG_TOUCHPOINT", taskOwner), assign: crmCan(actor, "ASSIGN", owner), postpone: !!taskOwner && crmCan(actor, "EDIT_TASK", taskOwner), escalate: !!taskOwner && crmCan(actor, "EDIT_TASK", taskOwner), assignPic: client.picAccountId === null && crmCan(actor, "CHANGE_PIC_OR_TEAM", clientOwner) },
    };
  })])) as Record<ReviewGroup, ReviewRow[]>;
  const week = crmWeekRange(now);
  const result: WeeklyReviewGroups = { week: { ...week, label: formatCrmWeekLabel(week.mondayKey) }, filters, groups, metrics: { overdue: groups.OVERDUE.length, dueThisWeek: groups.DUE_THIS_WEEK.length, noNextStep: groups.NO_NEXT_STEP.length }, isEmpty: Object.values(groups).every((g) => g.length === 0) };
  return { result, clients, settings, tierByClient, revenue, teams, pics };
}

export async function loadWeeklyReviewGroups(db: PrismaClient, actor: CrmActor, raw: ReviewRawFilters, now = new Date()): Promise<WeeklyReviewGroups> {
  return (await loadReviewCore(db, actor, raw, now, false)).result;
}

export const UPCOMING_EVENT_DAYS = 90;
/** Vietnam-time window an expected event covers: a day, a month or a quarter. */
export function expectedEventWindow(e: { precision: string; year: number; month: number | null; quarter: number | null; date: Date | null }): { start: Date; end: Date } | null {
  const monthStart = (y: number, m: number) => vnDayStartFromKey(`${y + Math.floor((m - 1) / 12)}-${String((m - 1) % 12 + 1).padStart(2, "0")}-01`);
  if (e.precision === "DAY" && e.date) { const start = vnDayStart(e.date); return { start, end: addDaysVn(start, 1) }; }
  if (e.precision === "MONTH" && e.month && e.month >= 1 && e.month <= 12) return { start: monthStart(e.year, e.month), end: monthStart(e.year, e.month + 1) };
  if (e.precision === "QUARTER" && e.quarter && e.quarter >= 1 && e.quarter <= 4) return { start: monthStart(e.year, (e.quarter - 1) * 3 + 1), end: monthStart(e.year, e.quarter * 3 + 1) };
  return null;
}

export async function loadWeeklyReview(db: PrismaClient, actor: CrmActor, raw: ReviewRawFilters, now = new Date()): Promise<WeeklyReview> {
  const core = await loadReviewCore(db, actor, raw, now, true);
  const clientIds = core.clients.map((c) => c.id);
  const year = Number(vnDateKey(now).slice(0, 4));
  // crm51: one count and one batched event query for the week bar and the right column; no per-client queries.
  const [draftPoints, doneThisWeek, events] = await Promise.all([
    db.touchpoint.findMany({ where: { clientId: { in: clientIds }, status: "DRAFT" }, select: { id: true, clientId: true, opportunityId: true, occurredAt: true, sourceType: true, sourceId: true }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }] }),
    db.task.count({ where: { status: "DONE", crmKind: { not: null }, completedAt: { gte: core.result.week.start, lt: core.result.week.end }, OR: [{ clientId: { in: clientIds } }, { opportunity: { clientId: { in: clientIds } } }] } }),
    db.expectedEvent.findMany({ where: { clientId: { in: clientIds }, status: "ACTIVE", year: { gte: year, lte: year + 1 } }, select: { id: true, clientId: true, precision: true, year: true, month: true, quarter: true, date: true, programType: { select: { label: true } } } }),
  ]);
  const meetingIds = [...new Set(draftPoints.filter((d) => d.sourceType === "MEETING" || d.sourceType === "RECAP").flatMap((d) => d.sourceId ? [d.sourceId] : []))];
  const meetings = await db.meeting.findMany({ where: { id: { in: meetingIds } }, select: { id: true, title: true } });
  const titles = new Map(meetings.map((m) => [m.id, m.title]));
  const clients = new Map(core.clients.map((c) => [c.id, c]));
  const drafts: DraftRow[] = draftPoints.map((d) => {
    const client = clients.get(d.clientId)!;
    const sourceLabel = d.sourceType === "RECAP" ? "Biên bản họp" : d.sourceType === "MEETING" ? "Họp TaskFlow" : "Nhập tracker";
    return { id: d.id, clientId: d.clientId, clientName: client.name, opportunityId: d.opportunityId, occurredAt: d.occurredAt, sourceLabel, title: d.sourceId ? titles.get(d.sourceId) ?? sourceLabel : sourceLabel, canConfirm: crmCan(actor, "LOG_TOUCHPOINT", clientResource(client)) };
  });
  const unrated: UnratedRow[] = core.clients.filter((c) => core.tierByClient.get(c.id)?.reason === "NOT_SCORED" && crmCan(actor, "SCORE_POTENTIAL", clientResource(c)))
    .map((c) => ({ clientId: c.id, name: c.name, revenue24m: core.revenue.get(c.id) ?? 0, version: c.version }))
    .sort((a, b) => b.revenue24m - a.revenue24m || a.name.localeCompare(b.name, "vi") || a.clientId.localeCompare(b.clientId)).slice(0, 50);
  const horizon = addDaysVn(vnDayStart(now), UPCOMING_EVENT_DAYS);
  const upcomingEvents: UpcomingEventRow[] = events.flatMap((e) => {
    const window = expectedEventWindow(e);
    if (!window || window.end <= vnDayStart(now) || window.start >= horizon) return [];
    return [{ id: e.id, clientId: e.clientId, clientName: clients.get(e.clientId)!.name, programLabel: e.programType.label, timingLabel: eventTimingLabel({ precision: e.precision as "DAY" | "MONTH" | "QUARTER", year: e.year, month: e.month, quarter: e.quarter, date: e.date }), startsAt: window.start }];
  }).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.clientName.localeCompare(b.clientName, "vi") || a.id.localeCompare(b.id)).slice(0, 8);
  return { ...core.result, doneThisWeek, upcomingEvents, metrics: { ...core.result.metrics, drafts: drafts.length }, teams: core.teams.map((t) => ({ id: t.id, name: "name" in t ? t.name as string : "" })), pics: core.pics, unrated, potentialScaleConfigured: core.settings.potentialScale.length > 0, drafts };
}
