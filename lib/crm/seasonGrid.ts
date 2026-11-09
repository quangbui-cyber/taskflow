import { vnDateKey } from "./dates";
import { EVENT_SOURCES } from "./labels";
import { programTypeDisplay } from "../programTypes";

export type SeasonProjectInput = { id: string; name: string; type: string; executionStartAt: Date | null; onProcessAt: Date | null };
export type SeasonEventInput = {
  id: string; programTypeCode: string; precision: "DAY" | "MONTH" | "QUARTER";
  year: number; month: number | null; quarter: number | null; date: Date | null;
  source: "CLIENT_CONFIRMED" | "HISTORY" | "INDUSTRY_SEASON"; status: string; revision: number;
  buyingUnitId?: string | null; buyingUnitName: string | null; note: string | null;
  steps: { id: string; kind: string; offsetDays: number | null; dueDate: Date; status: string; revision: number }[];
};
export type SeasonChip = {
  key: string; kind: "DONE" | "EVENT"; label: string; className: string; timingLabel: string;
  sourceLabel: string | null; buyingUnitName: string | null; projectId: string | null; eventId: string | null;
  programLabel: string; projectName: string | null;
  steps: { label: string; dueLabel: string; statusLabel: string }[]; edit: SeasonEventInput | null;
};
export const SEASON_CHIP_CLASSES = {
  DONE: "bg-zinc-900 text-white",
  CLIENT_CONFIRMED: "bg-emerald-50 text-emerald-700",
  HISTORY: "bg-white border border-dashed border-zinc-400 text-zinc-600",
  INDUSTRY_SEASON: "bg-white border border-dashed border-zinc-300 text-zinc-500",
};
export function reminderStepStatusLabel(status: string): string {
  return status === "DONE" ? "Đã làm" : status === "CLOSED" ? "Đã đóng" : "Sắp tới";
}
export function eventTimingLabel(event: Pick<SeasonEventInput, "precision" | "year" | "month" | "quarter" | "date">): string {
  if (event.precision === "QUARTER") return `Quý ${event.quarter}/${event.year}`;
  if (event.precision === "MONTH") return `Tháng ${event.month}/${event.year}`;
  if (!event.date) return "";
  return vnDateKey(event.date).split("-").reverse().join("/");
}
export function buildSeasonGrid({ projects, events, programTypes, now }: {
  projects: SeasonProjectInput[]; events: SeasonEventInput[];
  programTypes: Parameters<typeof programTypeDisplay>[0]; now: Date;
}): { month: number; chips: SeasonChip[] }[] {
  const months = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, chips: [] as SeasonChip[] }));
  const nowYear = Number(vnDateKey(now).slice(0, 4));
  const yearSuffix = (year: number) => year === nowYear ? "" : ` ${String(year).slice(-2)}`;
  for (const project of projects) {
    const date = project.executionStartAt ?? project.onProcessAt;
    if (!date) continue;
    const [year, month] = vnDateKey(date).split("-").map(Number);
    const programLabel = programTypeDisplay(programTypes, project.type).label;
    months[month - 1].chips.push({ key: `project-${project.id}`, kind: "DONE", label: programLabel + yearSuffix(year), className: SEASON_CHIP_CLASSES.DONE, timingLabel: eventTimingLabel({ precision: "DAY", year, month, quarter: null, date }), sourceLabel: "Đã làm với CS", buyingUnitName: null, projectId: project.id, eventId: null, programLabel, projectName: project.name, steps: [], edit: null });
  }
  const rank = { CLIENT_CONFIRMED: 1, HISTORY: 2, INDUSTRY_SEASON: 3 };
  for (const event of [...events].sort((a, b) => rank[a.source] - rank[b.source])) {
    if (!["ACTIVE", "BRIEF_RECEIVED"].includes(event.status)) continue;
    const month = event.precision === "QUARTER" ? (event.quarter! - 1) * 3 + 1 : event.precision === "DAY" && event.date ? Number(vnDateKey(event.date).slice(5, 7)) : event.month;
    if (!month || month < 1 || month > 12) continue;
    const programLabel = programTypeDisplay(programTypes, event.programTypeCode).label;
    months[month - 1].chips.push({
      key: `event-${event.id}`, kind: "EVENT", label: programLabel + (event.precision === "QUARTER" ? ` Q${event.quarter}?` : "") + yearSuffix(event.year),
      className: SEASON_CHIP_CLASSES[event.source], timingLabel: eventTimingLabel(event), sourceLabel: EVENT_SOURCES.find(s => s.key === event.source)!.label,
      buyingUnitName: event.buyingUnitName, projectId: null, projectName: null, eventId: event.id, programLabel, edit: event,
      steps: event.steps.filter(s => s.revision === event.revision && s.status !== "SUPERSEDED").sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id)).map(s => ({ label: s.kind === "VERIFY_MONTH" ? "Xác minh tháng" : `${s.offsetDays} ngày trước`, dueLabel: vnDateKey(s.dueDate).split("-").slice(1).reverse().join("/"), statusLabel: reminderStepStatusLabel(s.status) })),
    });
  }
  return months;
}
