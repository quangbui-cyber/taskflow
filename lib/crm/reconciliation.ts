import type { Prisma, PrismaClient, Project } from "@prisma/client";
import { KPI_RECOGNIZED_STATUSES, kpiYearRange, vietnamYearMonth } from "../kpi";
import { planLegacyMigration, type LegacyPlan } from "./legacyMigration";
import { mapLegacyProjectToOpportunity } from "./legacyMapping";
import { LEGACY_WON_STATUSES, competitiveWinRate, outsideWinRate, pipelineByStage } from "./metrics";
import { buildRevenueWinRateView, opportunityReportYear } from "./officialReport";
import { getCrmSettings } from "./settings";
import type { PipelineModeSetting } from "./pipelineMode";

type Db = PrismaClient | Prisma.TransactionClient;
export type ReconciliationProject = Pick<Project, "id" | "name" | "status" | "category" | "revenue" | "createdAt" | "onProcessAt" | "completedAt" | "sourceOpportunityId" | "accountId" | "type" | "clientId" | "ownerId" | "executionStartAt" | "executionEndAt"> & { sourceOpportunityTeamId: string | null; memberUserIds: string[] };
export type ReconciliationOpportunity = { id: string; stage: string; outcome: string | null; legacyStatus: string | null; legacyProjectId: string | null; budgetMin: number | null; budgetMax: number | null; closedAt: Date | null; createdAt: Date; responsibleTeamId: string | null; memberUserIds: string[] };
export type ReconciliationInput = { projects: ReconciliationProject[]; opportunities: ReconciliationOpportunity[]; pipelineMode: PipelineModeSetting };
export type ReconciliationSnapshot = { input: ReconciliationInput; plan: LegacyPlan; year: number };

/** Reports may request a scope; the CLI always loads company-wide invariants. */
export async function loadReconciliationInput(db: Db, opts: { projectIds?: string[] } = {}): Promise<ReconciliationInput> {
  const [projects, opportunities, settings] = await Promise.all([
    db.project.findMany({ where: opts.projectIds ? { id: { in: opts.projectIds } } : {}, select: { id: true, name: true, status: true, category: true, revenue: true, createdAt: true, onProcessAt: true, completedAt: true, sourceOpportunityId: true, accountId: true, type: true, clientId: true, ownerId: true, executionStartAt: true, executionEndAt: true, members: { select: { userId: true } }, sourceOpportunity: { select: { responsibleTeamId: true, picAccount: { select: { teamId: true } }, client: { select: { responsibleTeamId: true } } } } } }),
    db.opportunity.findMany({ where: opts.projectIds ? { OR: [{ legacyProjectId: { in: opts.projectIds } }, { project: { id: { in: opts.projectIds } } }] } : {}, select: { id: true, stage: true, outcome: true, legacyStatus: true, legacyProjectId: true, budgetMin: true, budgetMax: true, createdAt: true, closedAt: true, responsibleTeamId: true, opportunityMembers: { select: { userId: true } } } }),
    getCrmSettings(db),
  ]);
  return { projects: projects.map(({ members, sourceOpportunity, ...p }) => ({ ...p, memberUserIds: members.map((m) => m.userId), sourceOpportunityTeamId: sourceOpportunity?.responsibleTeamId ?? sourceOpportunity?.picAccount?.teamId ?? sourceOpportunity?.client.responsibleTeamId ?? null })), opportunities: opportunities.map(({ opportunityMembers, ...o }) => ({ ...o, budgetMin: o.budgetMin === null ? null : Number(o.budgetMin), budgetMax: o.budgetMax === null ? null : Number(o.budgetMax), memberUserIds: opportunityMembers.map((m) => m.userId) })), pipelineMode: settings.pipelineMode };
}

/** Only the explicitly selected rows are projected; review rows require explicit approval. */
export function projectAfterMigration(input: ReconciliationInput, plan: LegacyPlan, approvedReviewIds: string[] = []): ReconciliationInput {
  const selected = new Set(plan.rows.filter((r) => r.classification === "MIGRATE" || r.classification === "NEEDS_REVIEW" && approvedReviewIds.includes(r.projectId)).map((r) => r.projectId));
  const mapped = input.projects.filter((p) => selected.has(p.id)).map((p): ReconciliationOpportunity => {
    const o = mapLegacyProjectToOpportunity(p, { opportunityId: `projected:${p.id}` });
    return { id: o.id!, stage: o.stage!, outcome: o.outcome ?? null, legacyStatus: o.legacyStatus ?? null, legacyProjectId: p.id, budgetMin: null, budgetMax: o.budgetMax === null || o.budgetMax === undefined ? null : Number(o.budgetMax), closedAt: o.closedAt as Date | null, createdAt: p.createdAt, responsibleTeamId: null, memberUserIds: p.memberUserIds };
  });
  return { ...input, projects: input.projects.filter((p) => !selected.has(p.id)), opportunities: [...input.opportunities, ...mapped], pipelineMode: { ...input.pipelineMode, mode: "OPPORTUNITY_OFFICIAL" } };
}
const clientProjects = (input: ReconciliationInput) => input.projects.filter((p) => p.category === "CLIENT");
function legacyView(input: ReconciliationInput) {
  return buildRevenueWinRateView({ crmOn: true, setting: { ...input.pipelineMode, mode: "PROJECT_OFFICIAL" }, projects: clientProjects(input), opportunities: [] });
}
export function winRateCauses(before: ReconciliationInput, after?: ReconciliationInput, plan?: LegacyPlan, year?: number) {
  const next = after ?? (plan ? projectAfterMigration(before, plan) : before), view = legacyView(inReportYear(before, year)), projects = clientProjects(inReportYear(before, year));
  const opportunities = inReportYear(next, year).opportunities;
  const cause = (key: string, label: string, ids: string[]) => ({ key, label, count: ids.length, projectIds: ids });
  const ids = (predicate: (p: ReconciliationProject) => boolean) => projects.filter(predicate).map((p) => p.id);
  const unclassified = new Set(next.opportunities.filter((o) => o.outcome === "LEGACY_UNCLASSIFIED").map((o) => o.legacyProjectId).filter((id): id is string => !!id));
  return { legacy: { won: view.won, lost: view.lost, rate: view.rate }, competitive: competitiveWinRate(opportunities), outside: outsideWinRate(opportunities), causes: [
    cause("CANCEL_AFTER_WIN", "Dự án hủy sau khi đã thắng", ids((p) => p.status === "CANCEL" && (p.onProcessAt !== null || p.completedAt !== null))),
    cause("WON_BEFORE_CRM", "Dự án thắng trước khi có CRM", ids((p) => LEGACY_WON_STATUSES.includes(p.status) && !p.sourceOpportunityId)),
    cause("LEGACY_UNCLASSIFIED", "Dự án Fail/Cancel cũ chuyển sang Chưa rõ kết quả", ids((p) => unclassified.has(p.id))),
    cause("PILOT_EXCLUDED", "Deal của team pilot không tính trong số cũ", ids((p) => !view.legacyReportProjectIds.has(p.id))),
    // The CLI runs as an Admin over the whole company, so there is no scope delta.
    cause("SCOPE", "Phạm vi: Doanh số theo thành viên dự án, CRM toàn công ty (đối chiếu toàn công ty)", []),
    cause("YEAR_ANCHOR", "Mốc năm: onProcessAt hoặc createdAt so với closedAt", clientProjects(before).filter((p) => { const o = next.opportunities.find((o) => o.id === p.sourceOpportunityId || o.legacyProjectId === p.id), oldYear = vietnamYearMonth(p.onProcessAt ?? p.createdAt).year; return !!o && oldYear !== opportunityReportYear(o) && (year === undefined || oldYear === year || opportunityReportYear(o) === year); }).map((p) => p.id)),
  ] };
}
function inReportYear(input: ReconciliationInput, year?: number): ReconciliationInput {
  return year === undefined ? input : { ...input, projects: input.projects.filter((p) => vietnamYearMonth(p.onProcessAt ?? p.createdAt).year === year), opportunities: input.opportunities.filter((o) => opportunityReportYear(o) === year) };
}
export function pipelineComparison(before: ReconciliationInput, after: ReconciliationInput) {
  const view = legacyView(before), newByStage = pipelineByStage(after.opportunities.filter((o) => o.outcome === null).map((o) => ({ ...o, hasOverdueNextStep: false })));
  return { oldBiddingValue: view.biddingValue, oldBiddingCount: view.pipelineStages.find((s) => s.key === "BIDDING")!.count, newByStage, diff: newByStage.reduce((sum, s) => sum + s.budget, 0) - view.biddingValue };
}
export function recognizedRevenueByMonth(input: ReconciliationInput, year: number): Record<string, number> {
  const months: Record<string, number> = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${year}-${String(i + 1).padStart(2, "0")}`, 0]));
  const range = kpiYearRange(year);
  for (const p of clientProjects(input)) if (KPI_RECOGNIZED_STATUSES.includes(p.status) && p.onProcessAt && p.onProcessAt >= range.start && p.onProcessAt < range.end) months[`${year}-${String(vietnamYearMonth(p.onProcessAt).month).padStart(2, "0")}`] += p.revenue;
  return months;
}
export function compareRevenueInvariant(before: Record<string, number>, after: Record<string, number>) {
  const months = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().map((month) => ({ month, before: before[month] ?? 0, after: after[month] ?? 0 }));
  return { equal: months.every((m) => m.before === m.after), months };
}
export function failedCountByUserYear(input: ReconciliationInput) {
  const counts = new Map<string, { userId: string; year: number; failedCount: number }>();
  for (const p of clientProjects(input).filter((p) => p.status === "FAIL")) for (const year of new Set([vietnamYearMonth(p.createdAt).year, ...(p.onProcessAt ? [vietnamYearMonth(p.onProcessAt).year] : [])])) for (const userId of p.memberUserIds) {
    const key = `${userId}/${year}`, row = counts.get(key) ?? { userId, year, failedCount: 0 }; row.failedCount++; counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => a.userId.localeCompare(b.userId) || a.year - b.year);
}
function officialFailed(input: ReconciliationInput, source: "PROJECT" | "OPPORTUNITY") {
  const rows = failedCountByUserYear(input);
  if (source === "OPPORTUNITY") for (const o of input.opportunities.filter((o) => o.outcome === "LOST_COMPETITIVE" || o.outcome === "LEGACY_UNCLASSIFIED" && o.legacyStatus === "FAIL")) for (const year of new Set([vietnamYearMonth(o.createdAt).year, ...(o.closedAt ? [vietnamYearMonth(o.closedAt).year] : [])])) for (const userId of o.memberUserIds) {
    let row = rows.find((r) => r.userId === userId && r.year === year); if (!row) { row = { userId, year, failedCount: 0 }; rows.push(row); } row.failedCount++;
  }
  return rows;
}
function failedChange(before: ReturnType<typeof failedCountByUserYear>, after: ReturnType<typeof failedCountByUserYear>) {
  return [...new Set([...before, ...after].map((r) => `${r.userId}/${r.year}`))].sort().map((key) => { const row = [...before, ...after].find((r) => `${r.userId}/${r.year}` === key)!, b = before.find((r) => r.userId === row.userId && r.year === row.year)?.failedCount ?? 0, a = after.find((r) => r.userId === row.userId && r.year === row.year)?.failedCount ?? 0; return { userId: row.userId, year: row.year, before: b, after: a, diff: a - b }; });
}
function kpiRevenue(input: ReconciliationInput): Record<string, number> {
  const amounts: Record<string, number> = {};
  for (const p of clientProjects(input)) if (KPI_RECOGNIZED_STATUSES.includes(p.status) && p.onProcessAt) {
    const { year, month } = vietnamYearMonth(p.onProcessAt), anchor = `${year}-${String(month).padStart(2, "0")}`;
    for (const dimension of ["company", `account:${p.accountId ?? "unassigned"}`, ...p.memberUserIds.map((id) => `member:${id}`)]) { const key = `${anchor}/${dimension}`; amounts[key] = (amounts[key] ?? 0) + p.revenue; }
  }
  return amounts;
}
export function buildSnapshotReport(baseline: ReconciliationSnapshot, after: ReconciliationInput, opts: { phase: "DRY_RUN" | "POST_APPLY" | "POST_ROLLBACK"; batchId: string }) {
  const { input: before, plan, year } = baseline;
  const years = [...new Set([...before.projects, ...after.projects].flatMap((p) => p.onProcessAt ? [vietnamYearMonth(p.onProcessAt).year] : []).concat(year))];
  const allRevenue = (input: ReconciliationInput) => Object.assign({}, ...years.map((y) => recognizedRevenueByMonth(input, y))) as Record<string, number>;
  const statuses = (input: ReconciliationInput) => Object.fromEntries([...new Set(before.projects.concat(after.projects).map((p) => p.status))].sort().map((status) => [status, input.projects.filter((p) => p.status === status).length]));
  const selected = plan.rows.filter((r) => after.opportunities.some((o) => o.legacyProjectId === r.projectId));
  return { ...opts, year, scope: "COMPANY_ADMIN", countsByStatus: { before: statuses(before), after: statuses(after) }, classifications: { migrate: plan.rows.filter((r) => r.classification === "MIGRATE"), needsReview: plan.rows.filter((r) => r.classification === "NEEDS_REVIEW"), blocked: plan.rows.filter((r) => r.classification === "BLOCKED"), missingClient: plan.rows.filter((r) => r.classification === "MISSING_CLIENT") }, moved: Object.fromEntries(["tasks", "files", "meetings", "members", "notifications", "driveKeys"].map((key) => [key, selected.reduce((sum, r) => sum + r.counts[key as keyof typeof r.counts], 0)])), winRate: winRateCauses(before, after, undefined, year), pipeline: pipelineComparison(inReportYear(before, year), inReportYear(after, year)), revenueInvariant: compareRevenueInvariant(allRevenue(before), allRevenue(after)), kpiRevenueInvariant: compareRevenueInvariant(kpiRevenue(before), kpiRevenue(after)), failedCountChange: failedChange(failedCountByUserYear(before), failedCountByUserYear(after)), officialFailedCountChange: failedChange(officialFailed(before, before.pipelineMode.mode === "OPPORTUNITY_OFFICIAL" ? "OPPORTUNITY" : "PROJECT"), officialFailed(after, after.pipelineMode.mode === "OPPORTUNITY_OFFICIAL" ? "OPPORTUNITY" : "PROJECT")), notMigrated: { googleChatSpaces: plan.rows.filter((r) => r.hasChatSpace).map((r) => ({ projectId: r.projectId, name: r.name })), projectWishes: plan.rows.filter((r) => r.counts.wishes > 0).map((r) => ({ projectId: r.projectId, name: r.name, count: r.counts.wishes })) } };
}
export type ReconciliationReport = ReturnType<typeof buildSnapshotReport>;
export async function buildReconciliationReport(db: Db, opts: { phase: ReconciliationReport["phase"]; batchId: string; year: number; baseline?: ReconciliationSnapshot }): Promise<ReconciliationReport> {
  const input = await loadReconciliationInput(db);
  let baseline = opts.baseline;
  if (!baseline) {
    const records = await db.crmMigrationRecord.findMany({ where: { batchId: opts.batchId }, select: { legacyProjectId: true } });
    baseline = { input, plan: await planLegacyMigration(db, { projectIds: records.map((r) => r.legacyProjectId) }), year: opts.year };
  }
  return buildSnapshotReport(baseline, opts.phase === "DRY_RUN" ? projectAfterMigration(input, baseline.plan) : input, opts);
}
export function reconciliationToJson(report: ReconciliationReport) { return JSON.stringify(report, null, 2); }
export function reconciliationToCsv(report: ReconciliationReport): string {
  const rows: unknown[][] = [["section", "key", "before", "after", "diff", "ids"]];
  for (const [section, items] of Object.entries(report.classifications)) for (const r of items) rows.push([section, r.name, r.status, r.classification, r.reasons.join("; "), r.projectId]);
  for (const c of report.winRate.causes) rows.push(["winRateCauses", c.key, c.label, c.count, "", c.projectIds.join("; ")]);
  for (const [key, value] of Object.entries(report.winRate)) if (key !== "causes") rows.push(["winRate", key, "", JSON.stringify(value), "", ""]);
  for (const [status, count] of Object.entries(report.countsByStatus.before)) rows.push(["countsByStatus", status, count, report.countsByStatus.after[status] ?? 0, (report.countsByStatus.after[status] ?? 0) - count, ""]);
  for (const section of ["revenueInvariant", "kpiRevenueInvariant"] as const) for (const m of report[section].months) rows.push([section, m.month, m.before, m.after, m.after - m.before, ""]);
  for (const section of ["failedCountChange", "officialFailedCountChange"] as const) for (const r of report[section]) rows.push([section, `${r.userId}/${r.year}`, r.before, r.after, r.diff, r.userId]);
  rows.push(["pipeline", "total", report.pipeline.oldBiddingValue, report.pipeline.newByStage.reduce((sum, r) => sum + r.budget, 0), report.pipeline.diff, ""]);
  for (const r of report.pipeline.newByStage) rows.push(["pipeline", r.stage, "", r.budget, r.count, ""]);
  for (const [key, value] of Object.entries(report.moved)) rows.push(["moved", key, "", value, "", ""]);
  for (const [section, items] of Object.entries(report.notMigrated)) for (const r of items) rows.push(["notMigrated", section, r.name, "count" in r ? r.count : 1, "", r.projectId]);
  const cell = (value: unknown) => { let text = String(value ?? ""); if (/^[\s]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
  return `\uFEFF${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
