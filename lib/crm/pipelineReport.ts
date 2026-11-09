import { kpiYearRange, vietnamYearMonth } from "../kpi";
import { vnDayStart } from "./dates";
import { OPPORTUNITY_SOURCES, OUTCOME_LEVELS } from "./labels";
import { isPilotTeam, pipelineReportLabels, type PipelineModeSetting } from "./pipelineMode";

export const PIPELINE_PERIODS = [
  { key: "THIS_QUARTER", label: "Quý này" },
  { key: "LAST_QUARTER", label: "Quý trước" },
  { key: "THIS_YEAR", label: "Năm nay" },
] as const;
export type PipelinePeriodKey = typeof PIPELINE_PERIODS[number]["key"];
export function resolvePipelinePeriod(key: PipelinePeriodKey, now: Date) {
  const { year, month } = vietnamYearMonth(now);
  if (key === "THIS_YEAR") return kpiYearRange(year);
  const quarterMonth = Math.floor((month - 1) / 3) * 3 - (key === "LAST_QUARTER" ? 3 : 0);
  const boundary = (m: number) => new Date(Date.UTC(year, m, 1) - 7 * 3600000);
  return { start: boundary(quarterMonth), end: boundary(quarterMonth + 3) };
}
export type PipelineFilters = {
  period: PipelinePeriodKey; client: "ALL" | "NEW" | "EXISTING";
  teamId: string | null; programTypeCode: string | null; source: string | null; key: string;
};
export function parsePipelineFilters(params: Record<string, unknown>): PipelineFilters {
  const scalar = (key: string) => typeof params[key] === "string" && params[key].length <= 64 ? params[key].trim() : "";
  const rawPeriod = scalar("period");
  const period = PIPELINE_PERIODS.find((p) => p.key === rawPeriod)?.key ?? "THIS_QUARTER";
  const rawClient = scalar("client");
  const client = rawClient === "NEW" || rawClient === "EXISTING" ? rawClient : "ALL";
  const teamId = scalar("team") || null;
  const programTypeCode = scalar("program") || null;
  const source = OPPORTUNITY_SOURCES.find((s) => s.key === scalar("source"))?.key ?? null;
  const query = new URLSearchParams({ period });
  if (client !== "ALL") query.set("client", client);
  if (teamId) query.set("team", teamId);
  if (programTypeCode) query.set("program", programTypeCode);
  if (source) query.set("source", source);
  return { period, client, teamId, programTypeCode, source, key: query.toString() };
}
/** Báo cáo pilot chỉ dùng team được cấu hình; team ngoài pilot trả phạm vi rỗng. */
export function pipelineScope(setting: PipelineModeSetting, requestedTeamId: string | null) {
  const pilotOnly = setting.mode === "PROJECT_OFFICIAL" && setting.pilotTeamIds.length > 0;
  const teamIds = pilotOnly
    ? requestedTeamId ? isPilotTeam(setting, requestedTeamId) ? [requestedTeamId] : [] : [...setting.pilotTeamIds]
    : requestedTeamId ? [requestedTeamId] : null;
  return { teamIds, subtitle: pipelineReportLabels(setting).pipelineSubtitle, pilotOnly };
}
export function isNewClient(firstWinAt: Date | null, periodStart: Date) { return firstWinAt === null || firstWinAt >= periodStart; }
export function winRateTile({ won, lost, rate }: { won: number; lost: number; rate: number | null }) {
  return { value: rate === null ? "-" : `${rate}%`, caption: rate === null ? "Chưa có deal phân định" : `Thắng ${won} · Thua cạnh tranh ${lost}` };
}
export function outsideTile({ cancelled, declined, open, legacyUnclassified }: { cancelled: number; declined: number; open: number; legacyUnclassified: number }) {
  return { value: cancelled + declined, caption: `Khách hủy ${cancelled} · CS không tham gia ${declined} · Đang mở ${open}${legacyUnclassified > 0 ? ` · Chưa rõ kết quả ${legacyUnclassified}` : ""}` };
}
type EndReasonInput = { outcome: string | null; reasonLabel: string | null; programTypeCode: string; hasWinback: boolean; becameNewBrief: boolean };
export function endReasonTables(rows: EndReasonInput[]) {
  function groups(outcome: string) {
    const grouped = new Map<string, EndReasonInput[]>();
    for (const row of rows) if (row.outcome === outcome) {
      const label = row.reasonLabel || "Chưa ghi lý do";
      const items = grouped.get(label);
      if (items) items.push(row); else grouped.set(label, [row]);
    }
    return [...grouped].map(([reasonLabel, items]) => ({ reasonLabel, items, count: items.length }))
      .sort((a, b) => b.count - a.count || a.reasonLabel.localeCompare(b.reasonLabel, "vi"));
  }
  return {
    lost: groups("LOST_COMPETITIVE").map(({ reasonLabel, count, items }) => {
      const programs = new Map<string, number>();
      for (const item of items) programs.set(item.programTypeCode, (programs.get(item.programTypeCode) ?? 0) + 1);
      const mainProgramTypeCode = [...programs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return { reasonLabel, count, mainProgramTypeCode, withWinback: items.filter((r) => r.hasWinback).length, newBrief: items.filter((r) => r.becameNewBrief).length };
    }),
    cancelled: groups("CUSTOMER_CANCELLED").map(({ reasonLabel, count }) => ({ reasonLabel, count })),
    declined: groups("CS_DECLINED").map(({ reasonLabel, count }) => ({ reasonLabel, count })),
  };
}
export function usageSummary({ overdueTasks, drafts, touchpoints, now }: { overdueTasks: number; drafts: { createdAt: Date }[]; touchpoints: number; now: Date }) {
  const oldest = drafts.reduce<Date | null>((date, row) => date === null || row.createdAt < date ? row.createdAt : date, null);
  return { overdue: overdueTasks, draftCount: drafts.length, oldestDraftDays: oldest === null ? null : Math.max(0, Math.round((vnDayStart(now).getTime() - vnDayStart(oldest).getTime()) / 86400000)), touchpoints };
}
export function qualityBars(counts: Record<1 | 2 | 3 | 4, number>) {
  const max = Math.max(...Object.values(counts));
  return OUTCOME_LEVELS.map(({ key, label }) => ({ level: key, label, count: counts[key], percent: max ? Math.round(counts[key] / max * 100) : 0 }));
}
