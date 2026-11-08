import { KPI_TIME_ZONE } from "../kpi";
export type EventTiming = { precision: "DAY" | "MONTH" | "QUARTER"; year: number; month: number | null; quarter: number | null; date: Date | null };
export type PlannedStep = { kind: "OFFSET" | "VERIFY_MONTH"; offsetDays: number | null; dueDate: Date };
export type ExistingStep = { id: string; kind: string; offsetDays: number | null; status: "PLANNED" | "OPEN" | "DONE" | "CLOSED" | "SUPERSEDED"; taskId: string | null };
export type OpenCrmTask = { id: string; crmKind: string | null; opportunityId: string | null; clientId: string | null; programTypeCode: string | null; dueDate: Date | null };
const DAY = 86400000;
export function vnDay(date: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KPI_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00+07:00`);
}
export function eventAnchorDate(timing: EventTiming): Date | null {
  if (timing.precision === "DAY") return timing.date && Number.isFinite(timing.date.getTime()) ? vnDay(timing.date) : null;
  if (timing.precision === "MONTH" && timing.month && timing.month >= 1 && timing.month <= 12) return new Date(Date.UTC(timing.year, timing.month - 1, 1) - 7 * 3600000);
  return null;
}
export function planReminderSteps(timing: EventTiming, offsetsDays: number[], today: Date): PlannedStep[] {
  const offsets = [...new Set(offsetsDays.filter((n) => Number.isInteger(n) && n >= 1 && n <= 365))].sort((a, b) => b - a);
  if (!offsets.length) return [];
  const day = vnDay(today);
  if (timing.precision === "QUARTER") {
    if (!timing.quarter || timing.quarter < 1 || timing.quarter > 4) return [];
    const start = new Date(Date.UTC(timing.year, (timing.quarter - 1) * 3, 1) - 7 * 3600000);
    const end = new Date(Date.UTC(timing.year, timing.quarter * 3, 1) - 7 * 3600000);
    if (day >= end) return [];
    return [{ kind: "VERIFY_MONTH", offsetDays: null, dueDate: new Date(Math.max(day.getTime(), start.getTime() - offsets[0] * DAY)) }];
  }
  const anchor = eventAnchorDate(timing);
  if (!anchor || day > anchor) return [];
  const planned = offsets.map((offsetDays): PlannedStep => ({ kind: "OFFSET", offsetDays, dueDate: new Date(anchor.getTime() - offsetDays * DAY) }));
  const past = planned.filter((step) => step.dueDate < day);
  return [...(past.length ? [{ ...past[past.length - 1], dueDate: day }] : []), ...planned.filter((step) => step.dueDate >= day)];
}
export function rescheduleSteps(existing: ExistingStep[], next: PlannedStep[]) {
  const supersedeIds: string[] = [];
  const retarget: { stepId: string; taskId: string | null; dueDate: Date }[] = [];
  const remaining = [...next];
  for (const step of existing) {
    if (step.status === "SUPERSEDED") continue;
    const index = remaining.findIndex((n) => n.kind === step.kind && n.offsetDays === step.offsetDays);
    if (step.status === "PLANNED") supersedeIds.push(step.id);
    else if (step.status === "OPEN") {
      if (index >= 0) retarget.push({ stepId: step.id, taskId: step.taskId, dueDate: remaining.splice(index, 1)[0].dueDate });
      else supersedeIds.push(step.id);
    } else if (index >= 0) remaining.splice(index, 1);
  }
  return { supersedeIds, retarget, create: remaining };
}
export function pickConsolidationTarget(openTasks: OpenCrmTask[], step: { clientId: string; opportunityId: string | null; programTypeCode: string }): string | null {
  const kinds = ["APPOINTMENT", "PLAN_CLOSE", "NEXT_STEP", "EVENT_REMINDER", "VERIFY_MONTH"];
  const eligible = openTasks.filter((t) => kinds.includes(t.crmKind ?? "") && t.clientId === step.clientId && t.programTypeCode === step.programTypeCode).sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.id.localeCompare(b.id));
  return (step.opportunityId ? eligible.find((t) => t.opportunityId === step.opportunityId) : undefined)?.id ?? eligible.find((t) => t.opportunityId === null)?.id ?? null;
}
