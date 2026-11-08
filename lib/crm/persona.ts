import { vietnamYearMonth } from "../kpi";
import { competitiveWinRate, outsideWinRate } from "./metrics";
export const PERSONA_MIN_PROJECTS = 2;
export function computePersona(input: { projects: { type: string; executionStartAt: Date | null; revenue: number; won: boolean }[]; closedOpportunities: { outcome: string; reasonLabel: string | null }[] }) {
  const programs = new Map<string, number>();
  const months = new Map<number, number>();
  const reasons = new Map<string, number>();
  for (const project of input.projects) {
    programs.set(project.type, (programs.get(project.type) ?? 0) + 1);
    if (project.executionStartAt) {
      const { month } = vietnamYearMonth(project.executionStartAt);
      months.set(month, (months.get(month) ?? 0) + 1);
    }
  }
  for (const opportunity of input.closedOpportunities) if (opportunity.reasonLabel?.trim()) reasons.set(opportunity.reasonLabel, (reasons.get(opportunity.reasonLabel) ?? 0) + 1);
  const revenues = input.projects.filter((p) => p.won && Number.isFinite(p.revenue)).map((p) => p.revenue);
  const competition = competitiveWinRate(input.closedOpportunities);
  const outside = outsideWinRate(input.closedOpportunities);
  return {
    enoughData: input.projects.length >= PERSONA_MIN_PROJECTS,
    programHistory: [...programs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, count]) => ({ code, count })),
    typicalMonths: [...months].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([month]) => month),
    budgetRange: revenues.length ? { min: Math.min(...revenues), max: Math.max(...revenues) } : null,
    outcomes: { won: competition.won, lostCompetitive: competition.lost, cancelled: outside.cancelled, declined: outside.declined, reasons: [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, count]) => ({ label, count })) },
  };
}
