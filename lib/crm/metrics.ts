export const LEGACY_WON_STATUSES = ["ON_PROCESS", "DONE"];
export const LEGACY_LOST_STATUSES = ["CANCEL", "FAIL"];
type Outcome = { outcome: string | null };
const rate = (won: number, lost: number) => ({ won, lost, rate: won + lost ? Math.round(won / (won + lost) * 100) : null });
export function competitiveWinRate(opps: Outcome[]) {
  return rate(opps.filter((o) => o.outcome === "WON").length, opps.filter((o) => o.outcome === "LOST_COMPETITIVE").length);
}
export function outsideWinRate(opps: Outcome[]) {
  return { cancelled: opps.filter((o) => o.outcome === "CUSTOMER_CANCELLED").length, declined: opps.filter((o) => o.outcome === "CS_DECLINED").length, open: opps.filter((o) => o.outcome === null).length, legacyUnclassified: opps.filter((o) => o.outcome === "LEGACY_UNCLASSIFIED").length };
}
export function legacyWinRate(projects: { status: string }[]) {
  return rate(projects.filter((p) => LEGACY_WON_STATUSES.includes(p.status)).length, projects.filter((p) => LEGACY_LOST_STATUSES.includes(p.status)).length);
}
export function pipelineByStage(opps: { stage: string; budgetMin: number | null; budgetMax: number | null; hasOverdueNextStep: boolean }[]) {
  return ["CARE", "BRIEF", "BIDDING"].map((stage) => {
    const rows = opps.filter((o) => o.stage === stage);
    return { stage, count: rows.length, budget: rows.reduce((sum, o) => sum + (o.budgetMax ?? o.budgetMin ?? 0), 0), overdueNextSteps: rows.filter((o) => o.hasOverdueNextStep).length };
  });
}
export function nextStepCoverage(clients: { hasOpenNextStep: boolean; inCare: boolean }[]) {
  const total = clients.filter((c) => c.inCare).length;
  const covered = clients.filter((c) => c.inCare && c.hasOpenNextStep).length;
  return { covered, total, percent: total ? Math.round(covered / total * 100) : null };
}
export function careToBrief(opps: { reachedBrief: boolean; outcome: string | null }[]) {
  return { reached: opps.filter((o) => o.reachedBrief).length, total: opps.length, open: opps.filter((o) => o.outcome === null).length };
}
export function touchQuality(touchpoints: { clientId: string; outcomeLevel: number | null; status: string }[]): Record<1 | 2 | 3 | 4, number> {
  const highest = new Map<string, number>();
  for (const t of touchpoints) if (t.status === "CONFIRMED" && t.outcomeLevel !== null && Number.isInteger(t.outcomeLevel) && t.outcomeLevel >= 1 && t.outcomeLevel <= 4) highest.set(t.clientId, Math.max(highest.get(t.clientId) ?? 0, t.outcomeLevel));
  const result = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const level of highest.values()) result[level as 1 | 2 | 3 | 4]++;
  return result;
}
