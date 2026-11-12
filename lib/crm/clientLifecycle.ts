import { KPI_RECOGNIZED_STATUSES } from "../kpi";
import { competitiveWinRate } from "./metrics";
import { revenue24mWindow } from "./tier";

export type ClientLifecycle = "PROSPECT" | "ACTIVE" | "DORMANT" | "ARCHIVED";
export const CLIENT_LIFECYCLE_LABELS: Record<ClientLifecycle, string> = { PROSPECT: "Tiềm năng", ACTIVE: "Đang phục vụ", DORMANT: "Ngủ đông", ARCHIVED: "Lưu trữ" };
export const CLIENT_LIFECYCLE_KEYS = Object.keys(CLIENT_LIFECYCLE_LABELS) as ClientLifecycle[];
type RevenueProject = { status: string; onProcessAt: Date | null; revenue: number };

/** Same recognized set as loadClientRevenue24m (callers pass CLIENT Projects only), without the window. */
export function isRecognizedProject(project: { status: string; onProcessAt: Date | null }): boolean {
  return KPI_RECOGNIZED_STATUSES.includes(project.status) && project.onProcessAt !== null;
}

/** Computed only; never stored. A recognized Project still running counts as active whatever its start date. */
export function computeClientLifecycle(input: { archivedAt: Date | null; projects: { status: string; onProcessAt: Date | null }[]; now: Date }): ClientLifecycle {
  if (input.archivedAt) return "ARCHIVED";
  const recognized = input.projects.filter(isRecognizedProject);
  if (!recognized.length) return "PROSPECT";
  const { start } = revenue24mWindow(input.now);
  return recognized.some((project) => project.status === "ON_PROCESS" || project.onProcessAt! >= start) ? "ACTIVE" : "DORMANT";
}

export type ClientMetrics = { lifetimeRevenue: number; winRate: number | null; won: number; lost: number; averageWonValue: number | null; lastConfirmedTouchAt: Date | null };
/** Read-only 360 figures; nothing here is written back to Project, KPI or reports. */
export function computeClientMetrics(input: { projects: RevenueProject[]; opportunities: { outcome: string | null; contractValue: number | null }[]; lastConfirmedTouchAt: Date | null }): ClientMetrics {
  const lifetimeRevenue = input.projects.filter(isRecognizedProject).reduce((sum, project) => sum + (Number.isFinite(project.revenue) ? project.revenue : 0), 0);
  const rate = competitiveWinRate(input.opportunities);
  const values = input.opportunities.filter((o) => o.outcome === "WON" && o.contractValue !== null && Number.isFinite(o.contractValue)).map((o) => o.contractValue!);
  return { lifetimeRevenue, winRate: rate.rate, won: rate.won, lost: rate.lost, averageWonValue: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null, lastConfirmedTouchAt: input.lastConfirmedTouchAt };
}
