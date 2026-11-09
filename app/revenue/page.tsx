import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { loadProgramTypes, programTypeDisplay } from "@/lib/programTypes";
import { requireRevenueViewer } from "@/lib/auth";
import { crmEnabled } from "@/lib/features";
import { LEGACY_WON_STATUSES, LEGACY_LOST_STATUSES } from "@/lib/crm/metrics";
import { buildRevenueWinRateView, competitiveCountsBy, loadReportOpportunities, loadReportProjects, opportunityReportYear, resolveOfficialSource } from "@/lib/crm/officialReport";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import RevenueBreakdown, { type RevenueRow } from "@/components/RevenueBreakdown";
import RevenuePipeline from "@/components/RevenuePipeline";
import RevenueWinRate from "@/components/RevenueWinRate";
import MonthlyRevenueChart, {
  type MonthlyRevenuePoint,
} from "@/components/MonthlyRevenueChart";
import ProjectTypeMix from "@/components/ProjectTypeMix";
import ClientRevenueDonut, {
  type ClientRevenueRow,
} from "@/components/ClientRevenueDonut";
import ExecutionSchedule from "@/components/ExecutionSchedule";
import {
  PROJECT_STATUSES,
  formatVND,
  projectStatusColor,
} from "@/lib/types";
import {
  ChevronDown,
  CircleDollarSign,
  UsersRound,
} from "lucide-react";

const RECOGNIZED_REVENUE = ["ON_PROCESS", "DONE"];

const REVENUE_TIME_ZONE = "Asia/Ho_Chi_Minh";

function vietnamYearMonth(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REVENUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return { year, month, key: `${year}-${String(month).padStart(2, "0")}` };
}

function recentRevenueMonths(now = new Date()): MonthlyRevenuePoint[] {
  const current = vietnamYearMonth(now);
  const currentMonthIndex = current.year * 12 + current.month - 1;

  return Array.from({ length: 12 }, (_, index) => {
    const monthIndex = currentMonthIndex - 11 + index;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return {
      key: `${year}-${String(month).padStart(2, "0")}`,
      label: `T${month}/${String(year).slice(-2)}`,
      value: 0,
    };
  });
}

function yearMonths(year: number): MonthlyRevenuePoint[] {
  return Array.from({ length: 12 }, (_, index) => ({
    key: `${year}-${String(index + 1).padStart(2, "0")}`,
    label: `T${index + 1}`,
    value: 0,
  }));
}

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const [user, params] = await Promise.all([
    requireRevenueViewer(),
    searchParams,
  ]);
  const isAdmin = user.role === "ADMIN";

  // Admin thấy toàn bộ; Account chỉ thấy project mình tham gia
  const projectScope = isAdmin
    ? {}
    : { members: { some: { userId: user.id } } };

  const crmOn = crmEnabled();
  const [allProjects, sidebarProjects, { setting, source }] = await Promise.all([
    prisma.project.findMany({
      where: { ...projectScope, category: "CLIENT" },
      select: {
        id: true,
        name: true,
        color: true,
        status: true,
        type: true,
        executionStartAt: true,
        executionEndAt: true,
        revenue: true,
        onProcessAt: true,
        createdAt: true,
        client: { select: { id: true, name: true } },
        account: {
          select: {
            id: true,
            name: true,
            team: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { revenue: "desc" },
    }),
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
      select: {
        id: true,
        name: true,
        color: true,
        status: true,
        category: true,
        responsibleTeam: { select: { id: true, name: true } },
        responsibleGroup: { select: { id: true, name: true } },
        account: { select: { team: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    resolveOfficialSource(prisma, crmOn),
  ]);

  const [sourceTeams, allOpportunities] = await Promise.all([
    crmOn ? loadReportProjects(prisma, { ...projectScope, category: "CLIENT" }) : new Map<string, string | null>(),
    source === "OPPORTUNITY" ? loadReportOpportunities(prisma, isAdmin ? {} : { OR: [{ opportunityMembers: { some: { userId: user.id } } }, { picAccount: { userId: user.id } }] }) : [],
  ]);

  // Dự án thuộc năm ghi nhận doanh số (On Process); chưa On Process thì theo năm tạo.
  // Mặc định xem năm hiện tại để khớp với tab KPI.
  const projectYear = (p: (typeof allProjects)[number]) =>
    vietnamYearMonth(p.onProcessAt ?? p.createdAt).year;
  const currentYear = vietnamYearMonth(new Date()).year;
  const years = [
    ...new Set([...allProjects.map(projectYear), ...allOpportunities.map(opportunityReportYear), currentYear]),
  ].sort((a, b) => b - a);
  const requestedYear = Number(params.year);
  const selectedYear =
    params.year === "all"
      ? null
      : years.includes(requestedYear)
        ? requestedYear
        : currentYear;
  const projects =
    selectedYear === null
      ? allProjects
      : allProjects.filter((p) => projectYear(p) === selectedYear);

  const revenueOf = (statuses: string[]) =>
    projects
      .filter((p) => statuses.includes(p.status))
      .reduce((sum, p) => sum + p.revenue, 0);
  const countOf = (statuses: string[]) =>
    projects.filter((p) => statuses.includes(p.status)).length;

  const earned = revenueOf(RECOGNIZED_REVENUE);
  const opportunities = selectedYear === null ? allOpportunities : allOpportunities.filter((o) => opportunityReportYear(o) === selectedYear);
  const view = buildRevenueWinRateView({ crmOn, setting, projects: projects.map((p) => ({ ...p, sourceOpportunityTeamId: sourceTeams.get(p.id) ?? null })), opportunities });
  const activeProjectCount = countOf(["BIDDING", "ON_PROCESS"]);
  const teamCounts = competitiveCountsBy(opportunities, (o) => o.teamId);

  function groupRevenue(
    dimension: (p: (typeof projects)[number]) => { id: string; name: string } | null,
    counts?: ReturnType<typeof competitiveCountsBy>
  ): RevenueRow[] {
    const map = new Map<string, RevenueRow>();
    for (const p of projects) {
      const dim = dimension(p);
      const key = dim?.id ?? "__none__";
      const name = dim?.name ?? "Chưa gán";
      const entry = map.get(key) ?? {
        name,
        earned: 0,
        bidding: 0,
        count: 0,
        wonCount: 0,
        lostCount: 0,
      };
      entry.count += 1;
      if (RECOGNIZED_REVENUE.includes(p.status)) entry.earned += p.revenue;
      if (p.status === "BIDDING") entry.bidding += p.revenue;
      if (view.source === "PROJECT" && view.legacyReportProjectIds.has(p.id)) {
        if (LEGACY_WON_STATUSES.includes(p.status)) entry.wonCount += 1;
        if (LEGACY_LOST_STATUSES.includes(p.status)) entry.lostCount += 1;
      } else if (view.source === "OPPORTUNITY") {
        entry.wonCount = counts?.get(key)?.won ?? 0;
        entry.lostCount = counts?.get(key)?.lost ?? 0;
      }
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.earned - a.earned);
  }
  const clientMap = new Map<string, ClientRevenueRow>();
  for (const p of projects) {
    const key = p.client?.id ?? "__none__";
    const entry = clientMap.get(key) ?? {
      key,
      name: p.client?.name ?? "Chưa gán",
      earned: 0,
      bidding: 0,
      count: 0,
      wonCount: 0,
      lostCount: 0,
      projects: [],
    };
    entry.count += 1;
    if (RECOGNIZED_REVENUE.includes(p.status)) entry.earned += p.revenue;
    if (p.status === "BIDDING") entry.bidding += p.revenue;
    if (LEGACY_WON_STATUSES.includes(p.status)) entry.wonCount += 1;
    if (LEGACY_LOST_STATUSES.includes(p.status)) entry.lostCount += 1;
    entry.projects.push({
      id: p.id,
      name: p.name,
      status: p.status,
      revenue: p.revenue,
    });
    clientMap.set(key, entry);
  }
  const byClient = [...clientMap.values()].sort((a, b) => b.earned - a.earned);
  const byAccount: RevenueRow[] = source === "PROJECT" ? groupRevenue((p) => p.account) : [...competitiveCountsBy(opportunities, (o) => o.picAccountId)].map(([id, counts]) => ({ name: opportunities.find((o) => o.picAccountId === id)?.picAccountName ?? "Chưa gán", earned: 0, bidding: 0, count: counts.count, wonCount: counts.won, lostCount: counts.lost }));
  const byTeam = groupRevenue((p) => p.account?.team ?? null, teamCounts);
  const programTypes = await loadProgramTypes(prisma, { activeOnly: false });
  const typeSlices = programTypes.map((t) => {
    const group = projects.filter((p) => p.type === t.code);
    return {
      key: t.code,
      label: t.label,
      color: t.color,
      value: group
        .filter((p) => RECOGNIZED_REVENUE.includes(p.status))
        .reduce((sum, p) => sum + p.revenue, 0),
      bidding: group
        .filter((p) => p.status === "BIDDING")
        .reduce((sum, p) => sum + p.revenue, 0),
      count: group.length,
    };
  }).filter((slice) => slice.count > 0);
  // Lịch thực hiện là việc sắp tới nên không lọc theo năm đang xem.
  const scheduleRows = allProjects
    .filter(
      (p) =>
        p.executionStartAt &&
        (p.status === "BIDDING" || p.status === "ON_PROCESS")
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      status: p.status,
      executionStartAt: p.executionStartAt!,
      executionEndAt: p.executionEndAt,
    }));
  const monthlyRevenue =
    selectedYear === null ? recentRevenueMonths() : yearMonths(selectedYear);
  const monthlyRevenueByKey = new Map(
    monthlyRevenue.map((point) => [point.key, point])
  );
  for (const project of projects) {
    if (
      !RECOGNIZED_REVENUE.includes(project.status) ||
      !project.onProcessAt
    ) {
      continue;
    }
    const point = monthlyRevenueByKey.get(
      vietnamYearMonth(project.onProcessAt).key
    );
    if (point) point.value += project.revenue;
  }

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="revenue" />

      <main className="tf-main">
        <HubTabs section="revenue" role={user.role} />
        <div className="tf-page space-y-6">
          <div>
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700"
              >
                <CircleDollarSign size={20} aria-hidden="true" />
              </span>
              <h1 className="tf-page-title">
                Doanh số
              </h1>
            </div>
          </div>

          <nav className="flex flex-wrap gap-2" aria-label="Năm xem doanh số">
            {[...years.map((y) => ({ value: String(y), label: String(y) })), {
              value: "all",
              label: "Tất cả",
            }].map((option) => {
              const active =
                option.value === (selectedYear === null ? "all" : String(selectedYear));
              return (
                <Link
                  key={option.value}
                  href={`/revenue?year=${option.value}`}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-blue-600 bg-blue-600 font-medium text-white"
                      : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {option.label}
                </Link>
              );
            })}
          </nav>

          <div className="tf-metric-strip">
            <section className="tf-metric-item">
              <p className="text-xs font-medium text-zinc-500">Doanh số ghi nhận</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {formatVND(earned)}
              </p>
            </section>
            <section className="tf-metric-item">
              <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-zinc-500">Giá trị Bidding {view.pilotBadge && <span className="tf-badge bg-zinc-100 text-zinc-600">{view.pilotBadge}</span>}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {formatVND(view.biddingValue)}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {view.biddingCaption}
              </p>
            </section>
            <section className="tf-metric-item">
              <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-zinc-500">{view.winRateLabel} {view.pilotBadge && <span className="tf-badge bg-zinc-100 text-zinc-600">{view.pilotBadge}</span>}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {view.rateDisplay}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {view.caption}
              </p>
            </section>
            <section className="tf-metric-item">
              <p className="text-xs font-medium text-zinc-500">Dự án hoạt động</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {activeProjectCount}
              </p>
            </section>
          </div>

          {view.outsideLine && <p className="text-xs text-zinc-500">{view.outsideLine}</p>}

          <ExecutionSchedule rows={scheduleRows} programTypes={programTypes} />

          <MonthlyRevenueChart
            data={monthlyRevenue}
            periodLabel={
              selectedYear === null ? "12 tháng gần nhất" : `Năm ${selectedYear}`
            }
          />

          <RevenuePipeline stages={view.pipelineStages} title={view.pipelineTitle} unitLabel={source === "OPPORTUNITY" ? "Cơ hội" : "dự án"} />

          <ProjectTypeMix slices={typeSlices} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <RevenueBreakdown
              title="Doanh số theo Team"
              rows={byTeam}
              icon={UsersRound}
            />
            <RevenueWinRate rows={byAccount} {...(source === "OPPORTUNITY" ? { title: "Tỷ lệ thắng cạnh tranh theo Account", lostLabel: "Thua cạnh tranh", unitLabel: "Cơ hội" } : {})} />
          </div>

          <ClientRevenueDonut rows={byClient} />

          <section className="tf-panel overflow-hidden">
            <div className="border-b border-zinc-100 px-5 py-3">
              <h2 className="font-semibold">
                Các dự án ({projects.length})
              </h2>
            </div>
            {projects.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-400">
                Chưa có dự án nào.
              </p>
            ) : (
              PROJECT_STATUSES.map((s) => {
                const group = projects.filter((p) => p.status === s.key);
                if (group.length === 0) return null;
                const subtotal = group.reduce((sum, p) => sum + p.revenue, 0);
                return (
                  <details
                    key={s.key}
                    open
                    data-status={s.key}
                    className="group/project-status"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2 border-y border-zinc-100 bg-zinc-50 px-4 py-2 transition-colors hover:bg-zinc-100/70 [&::-webkit-details-marker]:hidden">
                      <span className={`tf-badge ${s.className}`}>{s.label}</span>
                      <span className="text-xs text-zinc-400">{group.length}</span>
                      <span className="ml-auto text-xs font-semibold tabular-nums text-zinc-600">
                        {formatVND(subtotal)}
                      </span>
                      <ChevronDown
                        size={16}
                        className="shrink-0 text-zinc-400 transition-transform group-open/project-status:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <div className="divide-y divide-zinc-50">
                      {group.map((p) => (
                        <Link
                          key={p.id}
                          href={`/projects/${p.id}`}
                          className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-50"
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: projectStatusColor(p.status) }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {p.name}
                          </span>
                          <span
                            className={`tf-badge hidden shrink-0 sm:inline-flex ${programTypeDisplay(programTypes, p.type).className}`}
                          >
                            {programTypeDisplay(programTypes, p.type).label}
                          </span>
                          <span className="hidden min-w-0 max-w-[220px] truncate text-xs text-zinc-400 sm:block">
                            {p.account?.name ?? "Chưa gán Account"} ·{" "}
                            {p.client?.name ?? "Chưa gán Client"}
                          </span>
                          <span className="max-w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-600 sm:w-[110px] sm:max-w-none sm:text-sm">
                            {formatVND(p.revenue)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </details>
                );
              })
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
