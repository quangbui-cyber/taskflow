import { vietnamYearMonth } from "../kpi";
import { TIER_ORDER } from "./labels";
import { isTierConfigured, type CadenceWeeks, type TierMatrix, type PotentialLevel, type RevenueBand, type TierValue } from "./settingsSchema";

/** Sum CLIENT Project.revenue for KPI_RECOGNIZED_STATUSES and onProcessAt in [start,end); excludes expected Opportunity budgets. */
export function revenue24mWindow(now: Date): { start: Date; end: Date } {
  const { year, month } = vietnamYearMonth(now);
  const vn = new Date(now.getTime() + 7 * 3600000);
  const day = Math.min(vn.getUTCDate(), new Date(Date.UTC(year - 2, month, 0)).getUTCDate());
  return { start: new Date(Date.UTC(year - 2, month - 1, day, vn.getUTCHours(), vn.getUTCMinutes(), vn.getUTCSeconds(), vn.getUTCMilliseconds()) - 7 * 3600000), end: new Date(now) };
}
export function revenuePercentiles(map: Map<string, number>): Map<string, number> {
  const rows = [...map].filter(([, n]) => Number.isFinite(n) && n > 0).sort((a, b) => a[1] - b[1]);
  const result = new Map<string, number>();
  for (let i = 0; i < rows.length;) {
    let end = i + 1;
    while (end < rows.length && rows[end][1] === rows[i][1]) end++;
    for (; i < end; i++) result.set(rows[i][0], end / rows.length * 100);
  }
  return result;
}
export function revenueBandFor(percentile: number | null, bands: RevenueBand[]): RevenueBand | null {
  const sorted = [...bands].sort((a, b) => a.minPercentile - b.minPercentile);
  if (percentile === null) return sorted[0] ?? null;
  return sorted.filter((band) => band.minPercentile <= percentile).at(-1) ?? sorted[0] ?? null;
}
export function computeTier(input: { potentialLevel: string | null; revenueBand: string | null; matrix: TierMatrix | null; scale: PotentialLevel[] }): { tier: TierValue; reason: "SCORED" | "NOT_SCORED" | "MATRIX_MISSING" } {
  if (!input.potentialLevel) return { tier: "UNRATED", reason: "NOT_SCORED" };
  if (!isTierConfigured(input.matrix, input.scale) || !input.scale.some(({ key }) => key === input.potentialLevel)) return { tier: "UNRATED", reason: "MATRIX_MISSING" };
  const band = input.revenueBand ?? revenueBandFor(null, input.matrix!.revenueBands)?.key;
  const tier = band ? input.matrix!.cells[band]?.[input.potentialLevel] : undefined;
  return tier ? { tier, reason: "SCORED" } : { tier: "UNRATED", reason: "MATRIX_MISSING" };
}
export function cadenceWeeksFor(tier: TierValue, cadence: CadenceWeeks): number { return cadence[tier]; }
export function compareTier(a: TierValue, b: TierValue): number { return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b); }
