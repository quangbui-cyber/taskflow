import type { Prisma, PrismaClient } from "@prisma/client";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { ownerNotificationFields } from "../workOwner";
import { cadencePeriodKey, isCadenceDue, nextCadenceDueDate } from "./cadence";
import { loadClientRevenue24m } from "./clientData";
import { addDaysVn, crmWeekRange, vnDateKey, vnDayStart } from "./dates";
import { REVIEW_REASON_LABELS } from "./labels";
import { eventAnchorDate, pickConsolidationTarget, type EventTiming, type OpenCrmTask } from "./reminders";
import { crmDedupeKey, dueMessage, missingNextStepMessage, overdueDays, overdueMessage, planClosePeriod, REACH_TASK_KINDS, reminderTaskTitle, REVIEW_WINDOW_KINDS, shouldNotifyOverdue, STALE_DRAFT_DAYS, staleDraftMessage } from "./reminderJobRules";
import { getCrmSettings } from "./settings";
import { cadenceWeeksFor, computeTier, revenueBandFor, revenuePercentiles } from "./tier";
import { produceMeetingDrafts } from "./touchpoints";
import { renewalPeriodKey, renewalReminderDue, renewalTaskTitle, type RenewalKind } from "./clientHub";
import { cadencePausedByCampaign } from "./campaignService";

type NotificationCandidate = { userId: string; type: string; message: string; taskId: string | null; clientId: string | null; opportunityId: string | null; dedupeKey: string };
export type CrmReminderJobSummary = {
  openedSteps: number; mergedSteps: number; cadenceTasks: number; planCloseTasks: number;
  passedEvents: number; meetingDrafts: number; notifications: NotificationCandidate[];
  skipped: { reason: string; id: string }[]; partial: boolean;
  /** crm53: vendor registration / framework contract renewal tasks opened this run. */
  renewalTasks?: number;
};
const activeUser = { isActive: true, deletedAt: null } as const;
const openTaskInclude = {
  opportunity: { select: { clientId: true, programTypeCode: true } },
  assignee: { select: { id: true, isActive: true, deletedAt: true } },
  reminderTask: { where: { status: "OPEN", expectedEvent: { status: "ACTIVE" } }, select: { expectedEvent: { select: { programTypeCode: true } } } },
} as const;
type JobTask = Prisma.TaskGetPayload<{ include: typeof openTaskInclude }>;
function logicalTasks(tasks: JobTask[], clientId: string): OpenCrmTask[] {
  return tasks.flatMap(task => {
    const programs = new Set([...(task.opportunity ? [task.opportunity.programTypeCode] : []), ...task.reminderTask.map(step => step.expectedEvent.programTypeCode)]);
    return [...programs].map(programTypeCode => ({ id: task.id, clientId, opportunityId: task.opportunityId, crmKind: task.crmKind, programTypeCode, dueDate: task.dueDate }));
  });
}

/** Writes reminder work atomically; notification candidates are inserted/deduped by the route.
 * Meeting provenance and its existing CRM_DRAFT notice remain owned by produceMeetingDrafts.
 */
/** crm54: allowedPicUserIds (cron in limited mode) limits cadence, event and renewal work to clients whose PIC may use CRM. */
export async function runCrmReminderJob(db: PrismaClient, opts: { now: Date; budgetMs?: number; allowedPicUserIds?: readonly string[] }): Promise<CrmReminderJobSummary> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 45_000;
  const now = opts.now;
  const today = vnDayStart(now);
  const week = crmWeekRange(now);
  const staleBefore = addDaysVn(today, -STALE_DRAFT_DAYS);
  const expired = () => Date.now() - started >= budgetMs;
  const summary: CrmReminderJobSummary = { openedSteps: 0, mergedSteps: 0, cadenceTasks: 0, planCloseTasks: 0, passedEvents: 0, meetingDrafts: 0, notifications: [], skipped: [], partial: false, renewalTasks: 0 };
  const allowedPics = opts.allowedPicUserIds ? new Set(opts.allowedPicUserIds) : null;
  const settings = await getCrmSettings(db);
  const revenue = await loadClientRevenue24m(db, now);
  const percentiles = revenuePercentiles(revenue);
  // Archived clients get no new cadence, plan-close or event reminders and no nudges until restored.
  const clients = await db.client.findMany({
    where: { archivedAt: null, OR: [
      { picAccountId: { not: null } }, { clientOpportunities: { some: { outcome: null } } }, { budgetSeasonMonth: { not: null } },
      { clientExpectedEvents: { some: { status: "ACTIVE" } } }, { clientTouchpoints: { some: { status: "DRAFT", createdAt: { lt: staleBefore } } } },
      { taskClient: { some: { status: OPEN_TASK_STATUS_FILTER, crmKind: { in: [...REACH_TASK_KINDS] } } } },
      { vendorRegisteredUntil: { not: null } }, { frameworkContractUntil: { not: null } },
    ], ...(allowedPics ? { picAccount: { userId: { in: [...allowedPics] } } } : {}) }, select: { id: true }, orderBy: { id: "asc" },
  });
  for (const { id: clientId } of clients) {
    if (expired()) { summary.partial = true; break; }
    const result = await db.$transaction(async tx => {
      // Same critical section as eventService and touchpoints; always re-read after acquiring it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientId}))`;
      const client = await tx.client.findUnique({ where: { id: clientId }, include: { picAccount: { include: { user: true } } } });
      const out = { openedSteps: 0, mergedSteps: 0, cadenceTasks: 0, planCloseTasks: 0, passedEvents: 0, renewalTasks: 0, notifications: [] as NotificationCandidate[], skipped: [] as { reason: string; id: string }[] };
      if (!client || client.archivedAt) return out;
      const picUser = client.picAccount?.user;
      // Re-checked under the client lock: the PIC may have changed since the list was read.
      if (allowedPics && !(picUser && allowedPics.has(picUser.id))) { out.skipped.push({ reason: "PIC_NOT_IN_CRM_ACCESS", id: clientId }); return out; }
      const assigneeId = picUser?.isActive && !picUser.deletedAt ? picUser.id : null;
      let fallbackCreator: string | null | undefined;
      async function creator(eventCreatorId?: string | null) {
        if (eventCreatorId) return eventCreatorId;
        if (assigneeId) return assigneeId;
        if (fallbackCreator !== undefined) return fallbackCreator;
        const teamId = client!.responsibleTeamId ?? client!.picAccount?.teamId;
        const manager = teamId ? await tx.crmTeamManager.findFirst({ where: { teamId, user: activeUser }, orderBy: { userId: "asc" }, select: { userId: true } }) : null;
        fallbackCreator = manager?.userId ?? (await tx.user.findFirst({ where: { ...activeUser, role: "ADMIN" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } }))?.id ?? null;
        return fallbackCreator;
      }
      const taskWhere: Prisma.TaskWhereInput = { status: OPEN_TASK_STATUS_FILTER, OR: [{ clientId }, { opportunity: { clientId, outcome: null } }] };
      const readTasks = () => tx.task.findMany({ where: taskWhere, include: openTaskInclude });
      const events = await tx.expectedEvent.findMany({ where: { clientId, status: "ACTIVE" }, include: { opportunity: { select: { id: true, outcome: true } }, programType: { select: { label: true } } } });
      for (const event of events) {
        const anchor = eventAnchorDate(event as EventTiming);
        if (anchor && anchor < today) {
          await tx.expectedEvent.update({ where: { id: event.id }, data: { status: "PASSED" } });
          await tx.reminderStep.updateMany({ where: { expectedEventId: event.id, status: "PLANNED" }, data: { status: "SUPERSEDED" } });
          out.passedEvents++;
        }
      }
      const tasks = await readTasks();
      const normalized = logicalTasks(tasks, clientId);
      const steps = await tx.reminderStep.findMany({ where: { status: "PLANNED", dueDate: { lt: week.end }, expectedEvent: { clientId, status: "ACTIVE" } }, orderBy: [{ dueDate: "asc" }, { id: "asc" }] });
      for (const step of steps) {
        const event = events.find(e => e.id === step.expectedEventId)!;
        const opportunityId = event.opportunity?.outcome === null ? event.opportunity.id : null;
        let taskId = pickConsolidationTarget(normalized, { clientId, opportunityId, programTypeCode: event.programTypeCode });
        if (taskId) {
          await tx.task.updateMany({ where: { id: taskId, OR: [{ dueDate: null }, { dueDate: { gt: step.dueDate } }] }, data: { dueDate: step.dueDate } });
          for (const task of normalized) if (task.id === taskId && (!task.dueDate || task.dueDate > step.dueDate)) task.dueDate = step.dueDate;
          out.mergedSteps++;
        } else {
          const creatorId = await creator(event.createdById);
          if (!creatorId) { out.skipped.push({ reason: "NO_CREATOR", id: step.id }); continue; }
          const task = await tx.task.create({ data: {
            title: reminderTaskTitle(step.kind === "VERIFY_MONTH" ? "VERIFY_MONTH" : "OFFSET", { clientName: client.name, programLabel: event.programType.label, offsetDays: step.offsetDays }),
            status: "TODO", crmKind: step.kind === "VERIFY_MONTH" ? "VERIFY_MONTH" : "EVENT_REMINDER", dueDate: step.dueDate, assigneeId, creatorId,
            clientId: opportunityId ? null : clientId, opportunityId,
          } });
          taskId = task.id;
          normalized.push({ id: task.id, clientId, opportunityId, programTypeCode: event.programTypeCode, crmKind: task.crmKind, dueDate: task.dueDate });
          out.openedSteps++;
        }
        await tx.reminderStep.update({ where: { id: step.id }, data: { status: "OPEN", taskId } });
      }

      // Reserve a period before creating work; skipDuplicates avoids aborting a transaction on P2002.
      async function periodTask(kind: "CADENCE" | "PLAN_CLOSE", period: { periodKey: string; dueDate: Date }) {
        const creatorId = await creator();
        if (!creatorId) { out.skipped.push({ reason: "NO_CREATOR", id: clientId }); return; }
        const reserved = await tx.cadenceReminder.createMany({ data: [{ clientId, periodKey: period.periodKey }], skipDuplicates: true });
        if (!reserved.count) return;
        const task = await tx.task.create({ data: { title: reminderTaskTitle(kind, { clientName: client!.name }), clientId, crmKind: kind, creatorId, assigneeId, status: "TODO", dueDate: period.dueDate } });
        await tx.cadenceReminder.update({ where: { clientId_periodKey: { clientId, periodKey: period.periodKey } }, data: { taskId: task.id } });
        if (kind === "PLAN_CLOSE") out.planCloseTasks++; else out.cadenceTasks++;
      }
      // crm53: one PIC task 30 days before a vendor registration or framework contract expires, reserved per expiry date.
      const renewals: [RenewalKind, Date | null][] = [["VENDOR", client.vendorStatus === "NOT_REGISTERED" || client.vendorStatus === "EXPIRED" ? null : client.vendorRegisteredUntil], ["FRAMEWORK", client.frameworkContractUntil]];
      for (const [kind, until] of renewals) {
        if (!until || !renewalReminderDue(until, now)) continue;
        const creatorId = await creator();
        if (!creatorId) { out.skipped.push({ reason: "NO_CREATOR", id: clientId }); continue; }
        const reserved = await tx.cadenceReminder.createMany({ data: [{ clientId, periodKey: renewalPeriodKey(kind, until) }], skipDuplicates: true });
        if (!reserved.count) continue;
        const task = await tx.task.create({ data: { title: renewalTaskTitle(kind, client.name, until), clientId, crmKind: "RENEWAL", creatorId, assigneeId, status: "TODO", dueDate: today } });
        await tx.cadenceReminder.update({ where: { clientId_periodKey: { clientId, periodKey: renewalPeriodKey(kind, until) } }, data: { taskId: task.id } });
        out.renewalTasks++;
        if (assigneeId) out.notifications.push({ userId: assigneeId, type: "CRM_NUDGE", message: `${task.title}.`, taskId: task.id, clientId, opportunityId: null, dedupeKey: crmDedupeKey(["renewal", kind.toLowerCase(), clientId, vnDateKey(until), assigneeId]) });
      }
      const close = planClosePeriod(client.budgetSeasonMonth, now);
      if (close) await periodTask("PLAN_CLOSE", close);
      let openTasks = await readTasks();
      const last = await tx.touchpoint.findFirst({ where: { clientId, status: "CONFIRMED" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], select: { occurredAt: true } });
      const band = revenueBandFor(percentiles.get(clientId) ?? null, settings.tierMatrix.revenueBands);
      const { tier } = computeTier({ potentialLevel: client.potentialLevel, revenueBand: band?.key ?? null, matrix: settings.tierMatrix, scale: settings.potentialScale });
      const cadenceWeeks = cadenceWeeksFor(tier, settings.cadenceWeeks);
      const cadence = { lastConfirmedAt: last?.occurredAt ?? null, clientCreatedAt: client.createdAt, cadenceWeeks, hasOpenCrmTask: openTasks.some(task => REVIEW_WINDOW_KINDS.some(kind => kind === task.crmKind)), hasActiveEventStepInWindow: !!await tx.reminderStep.count({ where: { status: { in: ["PLANNED", "OPEN"] }, dueDate: { lt: week.end }, expectedEvent: { clientId, status: "ACTIVE" } } }), weekEnd: week.end };
      // crm52: a running campaign with "pause cadence" on and an open step for this client holds the cadence task; event reminders are unaffected.
      if (!close && isCadenceDue(cadence) && !await cadencePausedByCampaign(tx, clientId)) {
        const dueDate = nextCadenceDueDate(cadence.lastConfirmedAt, client.createdAt, cadenceWeeks);
        await periodTask("CADENCE", { dueDate, periodKey: cadencePeriodKey(dueDate) });
        openTasks = await readTasks();
      }
      for (const task of openTasks) {
        if (!task.dueDate || !task.assignee?.isActive || task.assignee.deletedAt || !REACH_TASK_KINDS.some(kind => kind === task.crmKind)) continue;
        const days = overdueDays(task.dueDate, now);
        const dueToday = vnDateKey(task.dueDate) === vnDateKey(now);
        if (!dueToday && !shouldNotifyOverdue(days)) continue;
        const reason = REVIEW_REASON_LABELS[task.crmKind as keyof typeof REVIEW_REASON_LABELS] ?? task.title;
        const owner = ownerNotificationFields(task.opportunityId ? { kind: "OPPORTUNITY", id: task.opportunityId } : { kind: "CLIENT", id: clientId });
        out.notifications.push({ userId: task.assignee.id, type: dueToday ? "CRM_DUE" : "CRM_OVERDUE", message: dueToday ? dueMessage(client.name, reason) : overdueMessage(client.name, days), taskId: task.id, clientId: owner.clientId ?? null, opportunityId: owner.opportunityId ?? null, dedupeKey: crmDedupeKey([task.id, vnDateKey(now), task.assignee.id]) });
      }
      const staleDrafts = await tx.touchpoint.count({ where: { clientId, status: "DRAFT", createdAt: { lt: staleBefore } } });
      const noNext = !openTasks.length && !!await tx.opportunity.count({ where: { clientId, outcome: null } });
      if (staleDrafts || noNext) {
        const recipients = assigneeId ? [{ id: assigneeId }] : await tx.user.findMany({ where: { ...activeUser, isCrmDataSteward: true }, select: { id: true } });
        for (const { id: userId } of recipients) for (const kind of ["draft", "nonext"] as const) {
          if (kind === "draft" ? !staleDrafts : !noNext) continue;
          out.notifications.push({ userId, type: "CRM_NUDGE", message: kind === "draft" ? staleDraftMessage(client.name, staleDrafts) : missingNextStepMessage(client.name), taskId: null, clientId, opportunityId: null, dedupeKey: crmDedupeKey(["nudge", kind, clientId, week.mondayKey, userId]) });
        }
      }
      return out;
    }, { maxWait: 10_000, timeout: 15_000 });
    for (const key of ["openedSteps", "mergedSteps", "cadenceTasks", "planCloseTasks", "passedEvents"] as const) summary[key] += result[key];
    summary.renewalTasks = (summary.renewalTasks ?? 0) + result.renewalTasks;
    summary.notifications.push(...result.notifications); summary.skipped.push(...result.skipped);
  }
  if (!expired()) {
    const meetings = await db.meeting.findMany({ where: { status: { not: "CANCELLED" }, OR: [{ clientId: { not: null } }, { opportunityId: { not: null } }], endAt: { gte: new Date(now.getTime() - 48 * 3600000), lte: now } }, select: { id: true }, orderBy: [{ endAt: "asc" }, { id: "asc" }] });
    for (const meeting of meetings) {
      if (expired()) { summary.partial = true; break; }
      if (await db.touchpoint.findFirst({ where: { sourceId: meeting.id }, select: { id: true } })) continue;
      summary.meetingDrafts += (await produceMeetingDrafts(db, meeting.id, "MEETING")).created;
    }
  } else summary.partial = true;
  return summary;
}
