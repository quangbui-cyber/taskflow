import { formatCrmDate } from "./dates";
import { OPPORTUNITY_OUTCOMES, OPPORTUNITY_STAGES, OUTCOME_LEVELS, TOUCHPOINT_KINDS } from "./labels";
import { formatCompactVnd } from "./opportunityFormat";
import { dueLabel } from "./reviewView";
import { formatVND } from "../types";

/** Structural subset of ClientProfileData used by the profile summary and activity timeline. */
export type ClientProfileLike = {
  opportunities: {
    id: string; name: string; stage: string; outcome: string | null; createdAt: Date; closedAt: Date | null; wonAt: Date | null;
    contractValue: number | null; outcomeReason: { label: string } | null;
    nextStep: { id: string; title: string; dueDate: Date | null } | null;
  }[];
  tasks: { id: string; title: string; status: string; dueDate: Date | null; completedAt: Date | null; assignee: { name: string } | null }[];
  touchpoints: { id: string; occurredAt: Date; kind: string; outcomeLevel: number | null; notes: string | null; draft: boolean; author: { name: string } | null; opportunity: { id: string; name: string } | null }[];
  persona: { typicalMonths: number[] };
};
export type ClientNextTask = {
  id: string; title: string; dueDate: Date | null; assigneeName: string | null;
  opportunity: { id: string; name: string } | null; dueLabel: string | null; dueTone: "late" | "warn" | null;
};
const lowerFirst = (text: string) => text ? text[0].toLocaleLowerCase("vi") + text.slice(1) : text;
const isOpenTask = (status: string) => status !== "DONE" && status !== "CANCELLED";

export function clientSummary(profile: ClientProfileLike, now: Date) {
  const open = profile.opportunities.filter(o => o.outcome === null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  const latest = open[0] ?? null;
  const touch = profile.touchpoints.filter(t => !t.draft).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0] ?? null;
  const outcome = touch ? OUTCOME_LEVELS.find(level => level.key === touch.outcomeLevel)?.label : null;
  const candidates: Omit<ClientNextTask, "dueLabel" | "dueTone">[] = [
    ...profile.tasks.filter(t => isOpenTask(t.status)).map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate, assigneeName: t.assignee?.name ?? null, opportunity: null })),
    ...open.flatMap(o => o.nextStep ? [{ id: o.nextStep.id, title: o.nextStep.title, dueDate: o.nextStep.dueDate, assigneeName: null, opportunity: { id: o.id, name: o.name } }] : []),
  ].sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.id.localeCompare(b.id));
  const next = candidates[0] ?? null;
  const due = next?.dueDate ? dueLabel(next.dueDate, now) : null;
  return {
    status: latest ? OPPORTUNITY_STAGES.find(s => s.key === latest.stage)?.label ?? latest.stage : "Đang chăm sóc",
    openOpportunity: latest ? { id: latest.id, name: latest.name } : null,
    openOpportunityCount: open.length,
    lastTouch: touch ? { date: touch.occurredAt, label: `${formatCrmDate(touch.occurredAt, now)}${outcome ? ` · ${lowerFirst(outcome)}` : ""}` } : null,
    peakMonths: profile.persona.typicalMonths.length ? [...profile.persona.typicalMonths].sort((a, b) => a - b).map(m => `T${m}`).join(", ") : null,
    nextTask: next ? { ...next, dueLabel: due?.label ?? null, dueTone: due?.tone ?? null } : null,
  };
}

export type ClientActivityItem = {
  key: string; kind: "TOUCHPOINT" | "TASK_DONE" | "OPPORTUNITY_CLOSED"; date: Date; dateLabel: string;
  title: string; detail: string | null; actor: string | null; outcomeLevel: number | null; outcomeLabel: string | null;
  draft: boolean; touchpointId: string | null; opportunity: { id: string; name: string } | null; outcome: string | null;
};
/** Touchpoints, finished tasks and closed Opportunities on one newest-first timeline; drafts keep a flag. */
export function buildClientActivity(profile: ClientProfileLike, now: Date): ClientActivityItem[] {
  const items: ClientActivityItem[] = [];
  for (const t of profile.touchpoints) items.push({
    key: `touchpoint-${t.id}`, kind: "TOUCHPOINT", date: t.occurredAt, dateLabel: formatCrmDate(t.occurredAt, now),
    title: TOUCHPOINT_KINDS.find(k => k.key === t.kind)?.label ?? t.kind, detail: t.notes?.trim() ? t.notes : null, actor: t.author?.name ?? null,
    outcomeLevel: t.outcomeLevel, outcomeLabel: OUTCOME_LEVELS.find(l => l.key === t.outcomeLevel)?.label ?? null,
    draft: t.draft, touchpointId: t.id, opportunity: t.opportunity, outcome: null,
  });
  for (const t of profile.tasks) if (t.status === "DONE" && t.completedAt) items.push({
    key: `task-${t.id}`, kind: "TASK_DONE", date: t.completedAt, dateLabel: formatCrmDate(t.completedAt, now), title: "Việc xong", detail: t.title,
    actor: t.assignee?.name ?? null, outcomeLevel: null, outcomeLabel: null, draft: false, touchpointId: null, opportunity: null, outcome: null,
  });
  for (const o of profile.opportunities) {
    const date = o.closedAt ?? o.wonAt;
    if (o.outcome === null || !date) continue;
    const won = o.outcome === "WON";
    const extra = won ? o.contractValue !== null ? formatCompactVnd(o.contractValue) : null : o.outcomeReason?.label ?? null;
    items.push({
      key: `opportunity-${o.id}`, kind: "OPPORTUNITY_CLOSED", date, dateLabel: formatCrmDate(date, now),
      title: won ? "Thắng thầu" : OPPORTUNITY_OUTCOMES.find(x => x.key === o.outcome)?.label ?? o.outcome, detail: [o.name, extra].filter(Boolean).join(" · "),
      actor: null, outcomeLevel: null, outcomeLabel: null, draft: false, touchpointId: null, opportunity: { id: o.id, name: o.name }, outcome: o.outcome,
    });
  }
  return items.sort((a, b) => b.date.getTime() - a.date.getTime() || a.key.localeCompare(b.key));
}

export function formatBudgetSpan(range: { min: number; max: number } | null): string | null {
  if (!range) return null;
  return range.min === range.max ? formatVND(range.min) : `${formatVND(range.min)} - ${formatVND(range.max)}`;
}

type SeasonMonthLike = { month: number; chips: { key: string; kind: "DONE" | "EVENT"; label: string; sourceLabel: string | null }[] };
export type CompactSeasonTone = "DONE" | "CLIENT_CONFIRMED" | "GUESS" | null;
/** 6x2 read-only strip: first label in full, a count of the rest, and the strongest source. */
export function compactSeasonMonths(months: SeasonMonthLike[]): { month: number; label: string | null; more: number; tone: CompactSeasonTone; title: string | null }[] {
  return months.map(m => {
    const tone: CompactSeasonTone = !m.chips.length ? null : m.chips.some(c => c.kind === "DONE") ? "DONE" : m.chips.some(c => c.sourceLabel === "Khách xác nhận") ? "CLIENT_CONFIRMED" : "GUESS";
    return {
      month: m.month, label: m.chips[0]?.label ?? null, more: Math.max(0, m.chips.length - 1), tone,
      title: m.chips.length ? m.chips.map(c => c.sourceLabel ? `${c.label} · ${c.sourceLabel}` : c.label).join(", ") : null,
    };
  });
}
