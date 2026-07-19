import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireProjectManager } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import RevenueBreakdown, { type RevenueRow } from "@/components/RevenueBreakdown";
import RevenuePipeline from "@/components/RevenuePipeline";
import RevenueWinRate from "@/components/RevenueWinRate";
import MonthlyRevenueChart, {
  type MonthlyRevenuePoint,
} from "@/components/MonthlyRevenueChart";
import ProjectTypeMix from "@/components/ProjectTypeMix";
import ExecutionSchedule from "@/components/ExecutionSchedule";
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  formatVND,
  projectStatusColor,
  projectTypeInfo,
} from "@/lib/types";
import {
  Building2,
  ChevronDown,
  CircleDollarSign,
  Tags,
  UsersRound,
} from "lucide-react";

const WON = ["ON_PROCESS", "DONE"];
const LOST = ["CANCEL", "FAIL"];
const RECOGNIZED_REVENUE = ["ON_PROCESS", "DONE"];
const REVENUE_BLUE = "#2563eb";
const REVENUE_BLUE_DARK = "#1d4ed8";
const REVENUE_BLUE_SOFT = "#eff6ff";

const PIPELINE_STAGES = [
  { key: "BIDDING", label: "Bidding", color: "#f59e0b" },
  { key: "ON_PROCESS", label: "On Process", color: REVENUE_BLUE },
  { key: "DONE", label: "Done", color: "#10b981" },
  { key: "FAIL", label: "Fail", color: "#ef4444" },
  { key: "PENDING", label: "Pending", color: "#8b5cf6" },
  { key: "CANCEL", label: "Cancel", color: "#71717a" },
] as const;

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

export default async function RevenuePage() {
  const user = await requireProjectManager();
  const isAdmin = user.role === "ADMIN";

  // Admin thấy toàn bộ; Account chỉ thấy project mình tham gia
  const projectScope = isAdmin
    ? {}
    : { members: { some: { userId: user.id } } };

  const [projects, sidebarProjects] = await Promise.all([
    prisma.project.findMany({
      where: projectScope,
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
        account: {
          select: { team: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const revenueOf = (statuses: string[]) =>
    projects
      .filter((p) => statuses.includes(p.status))
      .reduce((sum, p) => sum + p.revenue, 0);
  const countOf = (statuses: string[]) =>
    projects.filter((p) => statuses.includes(p.status)).length;

  const earned = revenueOf(RECOGNIZED_REVENUE);
  const bidding = revenueOf(["BIDDING"]);
  const wonCount = countOf(WON);
  const lostCount = countOf(LOST);
  const closedCount = wonCount + lostCount;
  const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : null;
  const activeProjectCount = countOf(["BIDDING", "ON_PROCESS"]);
  const pipelineStages = PIPELINE_STAGES.map((stage) => ({
    ...stage,
    value: revenueOf([stage.key]),
    count: countOf([stage.key]),
  }));

  function groupRevenue(
    dimension: (p: (typeof projects)[number]) => { id: string; name: string } | null
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
      if (WON.includes(p.status)) entry.wonCount += 1;
      if (LOST.includes(p.status)) entry.lostCount += 1;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.earned - a.earned);
  }
  const byClient = groupRevenue((p) => p.client);
  const byAccount = groupRevenue((p) => p.account);
  const byTeam = groupRevenue((p) => p.account?.team ?? null);
  const byType = groupRevenue((p) => {
    const info = projectTypeInfo(p.type);
    return { id: info.key, name: info.label };
  });
  const typeSlices = PROJECT_TYPES.map((t) => {
    const group = projects.filter((p) => projectTypeInfo(p.type).key === t.key);
    return {
      key: t.key,
      label: t.label,
      color: t.color,
      value: group
        .filter((p) => RECOGNIZED_REVENUE.includes(p.status))
        .reduce((sum, p) => sum + p.revenue, 0),
      count: group.length,
    };
  }).filter((slice) => slice.count > 0);
  const scheduleRows = projects
    .filter((p) => p.executionStartAt)
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      status: p.status,
      executionStartAt: p.executionStartAt!,
      executionEndAt: p.executionEndAt,
    }));
  const monthlyRevenue = recentRevenueMonths();
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
        <div className="tf-page space-y-6">
          <div>
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-[8px]"
                style={{
                  backgroundColor: REVENUE_BLUE_SOFT,
                  color: REVENUE_BLUE_DARK,
                }}
              >
                <CircleDollarSign size={20} aria-hidden="true" />
              </span>
              <h1 className="tf-page-title" style={{ color: REVENUE_BLUE_DARK }}>
                Doanh số
              </h1>
            </div>
            {!isAdmin && (
              <p className="tf-page-subtitle">Chỉ tính các dự án bạn tham gia.</p>
            )}
          </div>

          <div className="tf-metric-strip">
            <section className="tf-metric-item">
              <p className="text-xs font-medium text-zinc-500">Doanh số ghi nhận</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {formatVND(earned)}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                On Process + Done
              </p>
            </section>
            <section className="tf-metric-item">
              <p className="text-xs font-medium text-zinc-500">Giá trị Bidding</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {formatVND(bidding)}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {countOf(["BIDDING"])} cơ hội đang mở
              </p>
            </section>
            <section className="tf-metric-item">
              <p className="text-xs font-medium text-zinc-500">Tỷ lệ thắng</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {winRate === null ? "—" : `${winRate}%`}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {wonCount} thắng · {lostCount} thua
              </p>
            </section>
            <section className="tf-metric-item">
              <p className="text-xs font-medium text-zinc-500">Dự án hoạt động</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {activeProjectCount}
              </p>
              <p className="mt-1 text-xs text-zinc-400">Bidding + On Process</p>
            </section>
          </div>

          <ExecutionSchedule rows={scheduleRows} />

          <MonthlyRevenueChart data={monthlyRevenue} />

          <RevenuePipeline stages={pipelineStages} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ProjectTypeMix slices={typeSlices} />
            <RevenueBreakdown
              title="Doanh số theo loại hình"
              rows={byType}
              icon={Tags}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <RevenueBreakdown
              title="Doanh số theo Team"
              rows={byTeam}
              icon={UsersRound}
            />
            <RevenueWinRate rows={byAccount} />
          </div>

          <RevenueBreakdown
            title="Doanh số theo Client"
            rows={byClient}
            icon={Building2}
          />

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
                            className={`tf-badge hidden shrink-0 sm:inline-flex ${projectTypeInfo(p.type).className}`}
                          >
                            {projectTypeInfo(p.type).label}
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
