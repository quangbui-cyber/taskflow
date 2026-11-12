import type { Prisma, PrismaClient } from "@prisma/client";
import { crmEnabled } from "../features";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { filterCrmAllowedUserIds } from "./access";
import { loadClientList } from "./clientData";
import { addDaysVn, vnDateKey, vnDayStart } from "./dates";
import { OUTCOME_LEVELS, TOUCHPOINT_KINDS } from "./labels";
import { crmCan, type CrmActor } from "./policy";
import { getCrmSettings, type CrmSettings } from "./settings";
import {
  CAMPAIGN_STOPPED_OPPORTUNITY, campaignEndKey, launchBlockers, parseCampaignAssignments, parseCampaignFilter, parseCampaignOptions, parseCampaignSteps,
  planCampaign, scheduleCampaign, selectCampaignClients, type CampaignCandidate, type CampaignDraft, type CampaignPic, type CampaignStatus,
} from "./campaignPlan";
import { addDaysToKey } from "../meetingCalendar";

type Db = PrismaClient | Prisma.TransactionClient;

/** crm52: Admin manages every campaign; a team campaign is managed by that team's CRM managers. */
export function canManageCampaign(actor: CrmActor, teamId: string | null): boolean {
  if (actor.role === "ADMIN") return crmCan(actor, "MANAGE_CAMPAIGN");
  return teamId !== null && crmCan(actor, "MANAGE_CAMPAIGN", { kind: "CLIENT", picUserId: null, teamId });
}

/** Users allowed to receive CRM work: with CRM on, the crm54 list (Admins plus listed); with CRM off, active users (library callers gate the flag). */
export async function crmWorkableUserIds(db: Db, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  if (crmEnabled()) return new Set(await filterCrmAllowedUserIds(db, userIds));
  const rows = await db.user.findMany({ where: { id: { in: userIds }, isActive: true, deletedAt: null }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

export async function loadCampaignPics(db: Db): Promise<CampaignPic[]> {
  const accounts = await db.account.findMany({ select: { id: true, name: true, userId: true, teamId: true }, orderBy: { name: "asc" } });
  const allowed = await crmWorkableUserIds(db, accounts.flatMap((a) => a.userId ? [a.userId] : []));
  return accounts.map((a) => ({ accountId: a.id, userId: a.userId, name: a.name, teamId: a.teamId, allowed: !!a.userId && allowed.has(a.userId) }));
}

/** Every client with the fields the wizard filters on. Tier and lifecycle come from the same loader as the client list. */
export async function loadCampaignCandidates(db: Db, settings: CrmSettings, now: Date): Promise<CampaignCandidate[]> {
  const list = await loadClientList(db, { includeArchived: true, take: 100_000 }, settings, now);
  const ids = list.rows.map((r) => r.id);
  const [events, bidding] = ids.length ? await Promise.all([
    db.expectedEvent.findMany({ where: { clientId: { in: ids }, status: "ACTIVE" }, select: { clientId: true, precision: true, month: true, quarter: true, date: true } }),
    db.opportunity.findMany({ where: { clientId: { in: ids }, outcome: null, stage: "BIDDING" }, select: { clientId: true }, distinct: ["clientId"] }),
  ]) : [[], []];
  const months = new Map<string, Set<number>>();
  const add = (clientId: string, month: number) => { const set = months.get(clientId) ?? new Set<number>(); set.add(month); months.set(clientId, set); };
  for (const e of events) {
    if (e.precision === "DAY" && e.date) add(e.clientId, Number(vnDateKey(e.date).slice(5, 7)));
    else if (e.precision === "MONTH" && e.month) add(e.clientId, e.month);
    else if (e.precision === "QUARTER" && e.quarter) for (let m = (e.quarter - 1) * 3 + 1; m <= e.quarter * 3; m++) add(e.clientId, m);
  }
  const biddingIds = new Set(bidding.map((b) => b.clientId));
  return list.rows.map((r) => {
    if (r.budgetSeasonMonth) add(r.id, r.budgetSeasonMonth);
    return {
      id: r.id, name: r.name, tier: r.tier, lifecycle: r.lifecycle, archived: r.archivedAt !== null, tagIds: r.tags.map((t) => t.id), industry: r.industry,
      teamId: r.responsibleTeamId ?? r.picAccount?.teamId ?? null, picAccountId: r.picAccountId, seasonMonths: [...(months.get(r.id) ?? [])].sort((a, b) => a - b), bidding: biddingIds.has(r.id),
    };
  });
}

/** Server-side preview: the same selection and schedule the launch uses, plus current open CRM work in the campaign weeks. */
export async function previewCampaign(db: Db, draft: CampaignDraft, now: Date, ctx?: { settings?: CrmSettings; candidates?: CampaignCandidate[]; pics?: CampaignPic[] }) {
  const settings = ctx?.settings ?? await getCrmSettings(db);
  const [candidates, pics] = await Promise.all([ctx?.candidates ?? loadCampaignCandidates(db, settings, now), ctx?.pics ?? loadCampaignPics(db)]);
  const selection = selectCampaignClients(candidates, draft.filter, { teamId: draft.teamId, skipBidding: draft.options.skipBidding, pics, assignments: draft.assignments });
  const scheduled = scheduleCampaign(draft.startKey, draft.steps);
  const allowedPics = pics.filter((p) => p.allowed && (!draft.teamId || p.teamId === draft.teamId));
  // A possible recipient needs a real load even before any campaign clients are assigned to them.
  const userIds = [...new Set([...selection.targets.map((t) => t.picUserId), ...allowedPics.flatMap((p) => p.userId ? [p.userId] : [])])];
  let existing: { userId: string; dateKey: string }[] = [];
  if (scheduled.length && userIds.length) {
    const firstKey = scheduled.reduce((min, s) => s.dueKey < min ? s.dueKey : min, scheduled[0].dueKey);
    const lastKey = campaignEndKey(draft.startKey, draft.steps);
    const from = addDaysVn(vnDayStart(new Date(`${firstKey}T00:00:00+07:00`)), -7);
    const to = addDaysVn(new Date(`${addDaysToKey(lastKey, 1)}T00:00:00+07:00`), 7);
    const open = await db.task.findMany({ where: { status: OPEN_TASK_STATUS_FILTER, crmKind: { not: null }, projectId: null, assigneeId: { in: userIds }, dueDate: { gte: from, lt: to } }, select: { assigneeId: true, dueDate: true } });
    existing = open.map((t) => ({ userId: t.assigneeId!, dateKey: vnDateKey(t.dueDate!) }));
  }
  const plan = planCampaign({ startKey: draft.startKey, steps: draft.steps, targets: selection.overLimit ? [] : selection.targets, existing, threshold: settings.campaignWeeklyLoadWarn, allowedPics });
  const blockers = launchBlockers({ steps: draft.steps, targets: selection.targets.length });
  if (draft.startKey < vnDateKey(now)) blockers.push("Ngày bắt đầu đã qua. Chọn hôm nay hoặc một ngày sau.");
  return { selection, scheduled, plan, blockers, threshold: settings.campaignWeeklyLoadWarn, pics: allowedPics };
}
export type CampaignPreview = Awaited<ReturnType<typeof previewCampaign>>;

export function draftFromRow(row: { name: string; goal: string | null; targetOpportunities: number | null; startDate: Date; endDate: Date | null; steps: unknown; options: unknown; filter: unknown; assignments: unknown; teamId: string | null }): CampaignDraft | null {
  const steps = parseCampaignSteps(row.steps), options = parseCampaignOptions(row.options), filter = parseCampaignFilter(row.filter), assignments = parseCampaignAssignments(row.assignments);
  if (!steps || !options || !filter || !assignments) return null;
  return { name: row.name, goal: row.goal, targetOpportunities: row.targetOpportunities, startKey: vnDateKey(row.startDate), endKey: row.endDate ? vnDateKey(row.endDate) : null, steps, options, filter, assignments, teamId: row.teamId };
}

/** Campaign rows the actor may see: managers see their campaigns, a PIC sees launched campaigns with own clients. */
function visibleWhere(actor: CrmActor): Prisma.CareCampaignWhereInput {
  if (actor.role === "ADMIN") return {};
  return { OR: [
    { teamId: { in: actor.managedTeamIds } },
    { status: { not: "DRAFT" }, targets: { some: { picAccount: { userId: actor.id } } } },
  ] };
}

export async function loadCampaignList(db: Db, actor: CrmActor) {
  const rows = await db.careCampaign.findMany({
    where: visibleWhere(actor), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200,
    select: { id: true, name: true, goal: true, status: true, startDate: true, endDate: true, teamId: true, targetOpportunities: true, launchedAt: true, steps: true, team: { select: { name: true } } },
  });
  const ids = rows.map((r) => r.id);
  const managedIds = rows.filter((r) => canManageCampaign(actor, r.teamId)).map((r) => r.id);
  const targetScope: Prisma.CareCampaignTargetWhereInput = { campaignId: { in: ids }, OR: [
    { campaignId: { in: managedIds } }, { picAccount: { userId: actor.id } },
  ] };
  const [done, open] = ids.length ? await Promise.all([
    db.careCampaignTask.groupBy({ by: ["targetId"], where: { target: targetScope, task: { status: "DONE" } }, _count: { _all: true } }),
    db.careCampaignTask.groupBy({ by: ["targetId"], where: { target: targetScope, task: { status: OPEN_TASK_STATUS_FILTER } }, _count: { _all: true } }),
  ]) : [[], []];
  const targetCampaign = new Map((ids.length ? await db.careCampaignTarget.findMany({ where: targetScope, select: { id: true, campaignId: true } }) : []).map((t) => [t.id, t.campaignId]));
  const clientCounts = new Map<string, number>();
  for (const campaignId of targetCampaign.values()) clientCounts.set(campaignId, (clientCounts.get(campaignId) ?? 0) + 1);
  const sum = (groups: { targetId: string; _count: { _all: number } }[], campaignId: string) => groups.reduce((n, g) => n + (targetCampaign.get(g.targetId) === campaignId ? g._count._all : 0), 0);
  return rows.map((r) => ({
    id: r.id, name: r.name, goal: r.goal, status: r.status as CampaignStatus, startDate: r.startDate, endDate: r.endDate ?? (parseCampaignSteps(r.steps) ? new Date(`${campaignEndKey(vnDateKey(r.startDate), parseCampaignSteps(r.steps)!)}T00:00:00+07:00`) : null),
    teamName: r.team?.name ?? null, clients: clientCounts.get(r.id) ?? 0, stepCount: parseCampaignSteps(r.steps)?.length ?? 0, doneTasks: sum(done, r.id), openTasks: sum(open, r.id),
    canManage: canManageCampaign(actor, r.teamId),
  }));
}
export type CampaignListRow = Awaited<ReturnType<typeof loadCampaignList>>[number];

export type CampaignCell = { taskId: string; status: string; dueDate: Date | null; completedAt: Date | null; closedReason: string | null; outcomeLevel: number | null; outcomeLabel: string | null; assigneeId: string | null };
/** Tracking screen: funnel from the outcome of touchpoints that completed campaign tasks, plus Opportunities opened after launch. */
export async function loadCampaignDetail(db: Db, actor: CrmActor, id: string, now: Date) {
  if (typeof id !== "string" || !id || id.length > 64) return null;
  const campaign = await db.careCampaign.findFirst({ where: { AND: [{ id }, visibleWhere(actor)] }, include: { team: { select: { id: true, name: true } }, createdBy: { select: { name: true } } } });
  if (!campaign) return null;
  const manage = canManageCampaign(actor, campaign.teamId);
  const steps = parseCampaignSteps(campaign.steps) ?? [];
  const targets = await db.careCampaignTarget.findMany({
    where: { campaignId: campaign.id, ...(manage ? {} : { picAccount: { userId: actor.id } }) },
    include: {
      client: { select: { id: true, name: true } }, picAccount: { select: { id: true, name: true, userId: true } },
      tasks: { include: { task: { select: { id: true, status: true, dueDate: true, completedAt: true, closedReason: true, assigneeId: true } }, touchpoint: { select: { outcomeLevel: true } } } },
    },
  });
  targets.sort((a, b) => a.client.name.localeCompare(b.client.name, "vi") || a.id.localeCompare(b.id));
  const clientIds = targets.map((t) => t.clientId);
  const opportunities = campaign.launchedAt && clientIds.length ? await db.opportunity.findMany({ where: { clientId: { in: clientIds }, createdAt: { gte: campaign.launchedAt } }, select: { id: true, clientId: true, name: true } }) : [];
  const oppByClient = new Map<string, { id: string; name: string }>();
  for (const o of opportunities) if (!oppByClient.has(o.clientId)) oppByClient.set(o.clientId, { id: o.id, name: o.name });
  const rows = targets.map((t) => {
    const cells: (CampaignCell | null)[] = steps.map((_, index) => {
      const link = t.tasks.find((x) => x.stepIndex === index);
      if (!link) return null;
      const level = link.touchpoint?.outcomeLevel ?? null;
      return { taskId: link.task.id, status: link.task.status, dueDate: link.task.dueDate, completedAt: link.task.completedAt, closedReason: link.task.closedReason, outcomeLevel: level, outcomeLabel: OUTCOME_LEVELS.find((l) => l.key === level)?.label ?? null, assigneeId: link.task.assigneeId };
    });
    const best = Math.max(0, ...cells.map((c) => c?.outcomeLevel ?? 0));
    return {
      targetId: t.id, clientId: t.clientId, clientName: t.client.name, pic: t.picAccount ? { name: t.picAccount.name, userId: t.picAccount.userId } : null,
      status: t.status, stoppedReason: t.stoppedReason, stoppedByOpportunity: t.stoppedReason === CAMPAIGN_STOPPED_OPPORTUNITY, cells, bestOutcome: best, opportunity: oppByClient.get(t.clientId) ?? null,
    };
  });
  const funnel = {
    clients: rows.length,
    contacted: rows.filter((r) => r.bestOutcome >= 1).length,
    responded: rows.filter((r) => r.bestOutcome >= 2).length,
    needs: rows.filter((r) => r.bestOutcome >= 4).length,
    opportunities: rows.filter((r) => r.opportunity).length,
    target: campaign.targetOpportunities,
  };
  const draft = campaign.status === "DRAFT" ? draftFromRow(campaign) : null;
  return {
    campaign: { id: campaign.id, name: campaign.name, goal: campaign.goal, status: campaign.status as CampaignStatus, version: campaign.version, startDate: campaign.startDate, endDate: campaign.endDate, launchedAt: campaign.launchedAt, teamId: campaign.teamId, teamName: campaign.team?.name ?? null, createdByName: campaign.createdBy?.name ?? null, targetOpportunities: campaign.targetOpportunities },
    steps: steps.map((s, i) => ({ ...s, index: i, kindLabel: TOUCHPOINT_KINDS.find((k) => k.key === s.kind)?.label ?? s.kind })),
    rows, funnel, canManage: manage, picCount: new Set(rows.map((r) => r.pic?.userId).filter(Boolean)).size, draft, todayKey: vnDateKey(now),
    openTasks: rows.reduce((n, r) => n + r.cells.filter((c) => c && c.status !== "DONE" && c.status !== "CANCELLED").length, 0),
  };
}
export type CampaignDetail = NonNullable<Awaited<ReturnType<typeof loadCampaignDetail>>>;

/** Wizard choices: filter values, managed teams, CRM-allowed PICs and active templates. */
export async function loadCampaignWizardOptions(db: Db, actor: CrmActor, settings: CrmSettings) {
  const [teams, tags, templates, pics, clients] = await Promise.all([
    db.salesTeam.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.clientTag.findMany({ where: { active: true }, select: { id: true, label: true }, orderBy: [{ order: "asc" }, { label: "asc" }] }),
    db.careCampaignTemplate.findMany({ where: { active: true }, orderBy: [{ order: "asc" }, { name: "asc" }] }),
    loadCampaignPics(db),
    db.client.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 5000 }),
  ]);
  return {
    clients,
    teams, ownerTeams: actor.role === "ADMIN" ? teams : teams.filter((t) => actor.managedTeamIds.includes(t.id)), isAdmin: actor.role === "ADMIN",
    tags, industries: settings.industries.filter((i) => i.active).map((i) => i.label),
    pics: pics.map((p) => ({ accountId: p.accountId, name: p.name, teamId: p.teamId, allowed: p.allowed })),
    templates: templates.flatMap((t) => { const steps = parseCampaignSteps(t.steps); return steps ? [{ id: t.id, name: t.name, description: t.description, steps }] : []; }),
    threshold: settings.campaignWeeklyLoadWarn,
  };
}
export type CampaignWizardOptions = Awaited<ReturnType<typeof loadCampaignWizardOptions>>;
