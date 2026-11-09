import type { Prisma, PrismaClient } from "@prisma/client";
import { vietnamYearMonth } from "../kpi";
import { competitiveWinRate, legacyWinRate, outsideWinRate, pipelineByStage } from "./metrics";
import { excludeFromLegacyReport, officialPipelineSource, pipelineReportLabels, type PipelineModeSetting } from "./pipelineMode";
import { OPPORTUNITY_STAGES } from "./labels";

export type ReportProject = { id: string; status: string; revenue: number; sourceOpportunityTeamId: string | null };
export type ReportOpportunity = { id: string; stage: string; outcome: string | null; budgetMin: number | null; budgetMax: number | null; picAccountId: string | null; picAccountName: string | null; teamId: string | null; clientId: string; createdAt: Date; closedAt: Date | null };
export const LEGACY_PIPELINE_STAGES = [
  { key: "BIDDING", label: "Bidding", color: "#93c5fd" }, { key: "ON_PROCESS", label: "On Process", color: "#2563eb" },
  { key: "DONE", label: "Done", color: "#1e3a8a" }, { key: "FAIL", label: "Fail", color: "#f87171" },
  { key: "PENDING", label: "Pending", color: "#d4d4d8" }, { key: "CANCEL", label: "Cancel", color: "#a1a1aa" },
] as const;
export const OPPORTUNITY_PIPELINE_COLORS = { CARE: "#d4d4d8", BRIEF: "#7dd3fc", BIDDING: "#fbbf24" };
export function opportunityReportYear(o: { createdAt: Date; closedAt: Date | null }): number { return vietnamYearMonth(o.closedAt ?? o.createdAt).year; }
export function competitiveCountsBy(opps: ReportOpportunity[], keyFn: (o: ReportOpportunity) => string | null): Map<string, { won: number; lost: number; count: number }> {
  const groups = new Map<string, ReportOpportunity[]>();
  for (const o of opps) { const key = keyFn(o); if (key !== null) { const rows = groups.get(key) ?? []; rows.push(o); groups.set(key, rows); } }
  return new Map([...groups].map(([key, rows]) => { const { won, lost } = competitiveWinRate(rows); return [key, { won, lost, count: rows.length }]; }));
}
export type RevenueWinRateView = { source: "PROJECT" | "OPPORTUNITY"; winRateLabel: string; won: number; lost: number; rate: number | null; rateDisplay: string; caption: string; outsideLine: string | null; pilotBadge: string | null; biddingValue: number; biddingCaption: string; pipelineTitle: string; pipelineStages: { key: string; label: string; value: number; count: number; color: string }[]; legacyReportProjectIds: Set<string> };
export function buildRevenueWinRateView(input: { crmOn: boolean; setting: PipelineModeSetting | null; projects: ReportProject[]; opportunities: ReportOpportunity[] }): RevenueWinRateView {
  const { crmOn, setting } = input;
  const source = crmOn && setting ? officialPipelineSource(setting) : "PROJECT";
  if (source === "PROJECT") {
    const projects = input.projects.filter((p) => !crmOn || !setting || !excludeFromLegacyReport(setting, p));
    const { won, lost, rate } = legacyWinRate(projects), bidding = projects.filter((p) => p.status === "BIDDING");
    return { source, winRateLabel: "Tỷ lệ thắng", won, lost, rate, rateDisplay: rate === null ? "—" : `${rate}%`, caption: `${won} thắng · ${lost} thua`, outsideLine: null, pilotBadge: crmOn && setting ? pipelineReportLabels(setting).legacyBadge : null,
      biddingValue: bidding.reduce((sum, p) => sum + p.revenue, 0), biddingCaption: `${bidding.length} cơ hội đang mở`, pipelineTitle: "Pipeline dự án", legacyReportProjectIds: new Set(projects.map((p) => p.id)),
      pipelineStages: LEGACY_PIPELINE_STAGES.map((stage) => { const rows = projects.filter((p) => p.status === stage.key); return { ...stage, value: rows.reduce((sum, p) => sum + p.revenue, 0), count: rows.length }; }) };
  }
  const { won, lost, rate } = competitiveWinRate(input.opportunities), outside = outsideWinRate(input.opportunities);
  const pipelineStages = pipelineByStage(input.opportunities.filter((o) => o.outcome === null).map((o) => ({ ...o, hasOverdueNextStep: false }))).map((s) => ({ key: s.stage, label: OPPORTUNITY_STAGES.find((x) => x.key === s.stage)!.label, value: s.budget, count: s.count, color: OPPORTUNITY_PIPELINE_COLORS[s.stage as keyof typeof OPPORTUNITY_PIPELINE_COLORS] }));
  const bidding = pipelineStages.find((s) => s.key === "BIDDING")!;
  return { source, winRateLabel: "Tỷ lệ thắng cạnh tranh", won, lost, rate, rateDisplay: rate === null ? "-" : `${rate}%`, caption: won + lost ? `Thắng ${won} / (Thắng ${won} + Thua cạnh tranh ${lost})` : "Chưa có deal phân định",
    outsideLine: `Khách hủy ${outside.cancelled} · CS không tham gia ${outside.declined} · Đang mở ${outside.open}${outside.legacyUnclassified ? ` · Chưa rõ kết quả ${outside.legacyUnclassified}` : ""}`, pilotBadge: null, biddingValue: bidding.value, biddingCaption: `${bidding.count} Cơ hội ở Bidding`, pipelineTitle: "Pipeline Cơ hội", pipelineStages, legacyReportProjectIds: new Set() };
}
type Db = PrismaClient | Prisma.TransactionClient;
export async function resolveOfficialSource(db: Db, crmOn: boolean): Promise<{ setting: PipelineModeSetting | null; source: "PROJECT" | "OPPORTUNITY" }> {
  if (!crmOn) return { setting: null, source: "PROJECT" };
  const { getCrmSettings } = await import("./settings"), { pipelineMode: setting } = await getCrmSettings(db);
  return { setting, source: officialPipelineSource(setting) };
}
export async function loadReportProjects(db: Db, where: Prisma.ProjectWhereInput): Promise<Map<string, string | null>> {
  const rows = await db.project.findMany({ where: { AND: [where, { sourceOpportunityId: { not: null } }] }, select: { id: true, sourceOpportunity: { select: { responsibleTeamId: true, picAccount: { select: { teamId: true } }, client: { select: { responsibleTeamId: true } } } } } });
  return new Map(rows.map((p) => [p.id, p.sourceOpportunity?.responsibleTeamId ?? p.sourceOpportunity?.picAccount?.teamId ?? p.sourceOpportunity?.client.responsibleTeamId ?? null]));
}
export async function loadReportOpportunities(db: Db, where: Prisma.OpportunityWhereInput): Promise<ReportOpportunity[]> {
  const rows = await db.opportunity.findMany({ where, select: { id: true, stage: true, outcome: true, budgetMin: true, budgetMax: true, picAccountId: true, picAccount: { select: { name: true, teamId: true } }, responsibleTeamId: true, clientId: true, client: { select: { responsibleTeamId: true, picAccount: { select: { teamId: true } } } }, createdAt: true, closedAt: true } });
  return rows.map((o) => ({ id: o.id, stage: o.stage, outcome: o.outcome, budgetMin: o.budgetMin === null ? null : Number(o.budgetMin), budgetMax: o.budgetMax === null ? null : Number(o.budgetMax), picAccountId: o.picAccountId, picAccountName: o.picAccount?.name ?? null, teamId: o.responsibleTeamId ?? o.picAccount?.teamId ?? o.client.responsibleTeamId ?? o.client.picAccount?.teamId ?? null, clientId: o.clientId, createdAt: o.createdAt, closedAt: o.closedAt }));
}
export async function loadOpportunityParticipation(db: Db, userId: string, range: { start: Date; end: Date }): Promise<{ joined: number; failed: number }> {
  const inYear = { gte: range.start, lt: range.end };
  const rows = await db.opportunity.findMany({ where: { opportunityMembers: { some: { userId } }, AND: [{ OR: [{ outcome: null }, { outcome: { not: "WON" } }] }, { OR: [{ createdAt: inYear }, { closedAt: inYear }] }] }, select: { outcome: true, legacyStatus: true } });
  return { joined: rows.length, failed: rows.filter((o) => o.outcome === "LOST_COMPETITIVE" || o.outcome === "LEGACY_UNCLASSIFIED" && o.legacyStatus === "FAIL").length };
}
export async function countBiddingOpportunitiesByUser(db: Db, userIds: string[]): Promise<Map<string, number>> {
  const rows = await db.opportunityMember.groupBy({ by: ["userId"], where: { userId: { in: userIds }, opportunity: { stage: "BIDDING", outcome: null } }, _count: true });
  return new Map(rows.map((r) => [r.userId, r._count]));
}
