import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeDirectReportsWhere } from "@/lib/directReports";
import { requireUser } from "@/lib/auth";
import {
  combinePeriodResultsWithActiveWork,
  computePerf,
  getPerformancePeriod,
  PERFORMANCE_PERIOD_OPTIONS,
} from "@/lib/performance";
import { isOverdue } from "@/lib/dates";
import Sidebar from "@/components/Sidebar";
import Avatar from "@/components/Avatar";
import PerformanceBar from "@/components/PerformanceBar";
import TaskListItem from "@/components/TaskListItem";
import RoleBadge from "@/components/RoleBadge";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Inbox,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  ARCHIVED_PROJECT_STATUS_KEYS,
  isArchivedProjectStatus,
} from "@/lib/types";

const taskInclude = {
  project: { select: { id: true, name: true, color: true, status: true } },
  assignee: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} as const;

function ProjectParticipation({
  bidding,
  onProcess,
}: {
  bidding: number;
  onProcess: number;
}) {
  return (
    <span className="flex items-center gap-4">
      <span>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden="true" />
          On Process
        </span>
        <strong className="mt-0.5 block text-base font-semibold tabular-nums text-zinc-800">
          {onProcess}
        </strong>
      </span>
      <span className="h-8 w-px bg-zinc-200" aria-hidden="true" />
      <span>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          Bidding
        </span>
        <strong className="mt-0.5 block text-base font-semibold tabular-nums text-zinc-800">
          {bidding}
        </strong>
      </span>
    </span>
  );
}

function onTimeRateClass(rate: number | null) {
  if (rate === null) return "text-zinc-400";
  if (rate >= 80) return "text-brand-700";
  if (rate >= 60) return "text-amber-600";
  return "text-red-600";
}

type TeamHighlight = {
  names: string[];
  value: number;
} | null;

function HighlightCard({
  label,
  highlight,
  unit,
  icon: Icon,
  iconClassName,
}: {
  label: string;
  highlight: TeamHighlight;
  unit: string;
  icon: LucideIcon;
  iconClassName: string;
}) {
  const fullNames = highlight?.names.join(", ") ?? "";
  const displayNames = highlight
    ? highlight.names.length > 2
      ? `${highlight.names.slice(0, 2).join(", ")} +${highlight.names.length - 2}`
      : fullNames
    : "Chưa có dữ liệu";

  return (
    <div className="flex min-h-28 gap-3 p-4 sm:min-h-32">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] ${iconClassName}`}
      >
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        <p className="mt-1 truncate text-base font-semibold text-zinc-950" title={fullNames}>
          {displayNames}
        </p>
        <p className="mt-2 text-sm tabular-nums text-zinc-500">
          {highlight ? `${highlight.value} ${unit}` : "—"}
        </p>
      </div>
    </div>
  );
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const { period: periodParam } = await searchParams;
  const period = getPerformancePeriod(periodParam);
  const performanceTaskWhere: Prisma.TaskWhereInput = {
    OR: [
      { status: { not: "DONE" } },
      {
        status: "DONE",
        completedAt: { gte: period.start, lt: period.end },
      },
    ],
  };

  const [members, myTasks, sidebarProjects, allOpenTasks, unassigned] =
    await Promise.all([
      // Admin thấy mọi nhân viên; quản lý thấy nhân viên trực tiếp của mình
      prisma.user.findMany({
        where: isAdmin
          ? { id: { not: user.id }, deletedAt: null }
          : activeDirectReportsWhere(user.id),
        include: {
          assignedTasks: {
            where: performanceTaskWhere,
            include: taskInclude,
            orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
          },
          createdTasks: {
            where: { status: { not: "DONE" } },
            include: taskInclude,
            orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
          },
          manager: { select: { name: true } },
          memberships: {
            where: {
              project: { status: { in: ["BIDDING", "ON_PROCESS"] } },
            },
            select: {
              project: { select: { id: true, status: true } },
            },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.task.findMany({
        where: { assigneeId: user.id, ...performanceTaskWhere },
        select: {
          status: true,
          dueDate: true,
          completedAt: true,
          project: { select: { status: true } },
        },
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
      // Thống kê toàn công ty (chỉ admin)
      isAdmin
        ? prisma.task.findMany({
            where: {
              status: { not: "DONE" },
              project: { status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] } },
            },
            select: { status: true, dueDate: true },
          })
        : Promise.resolve([]),
      isAdmin
        ? prisma.task.findMany({
            where: {
              assigneeId: null,
              status: { not: "DONE" },
              project: { status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] } },
            },
            include: {
              project: { select: { id: true, name: true, color: true, status: true } },
            },
            orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
          })
        : Promise.resolve([]),
    ]);

  const myPeriodPerf = computePerf(myTasks);
  const myActiveWorkPerf = computePerf(
    myTasks.filter(
      (task) =>
        task.status !== "DONE" &&
        !isArchivedProjectStatus(task.project.status)
    )
  );
  const myPerf = combinePeriodResultsWithActiveWork(
    myPeriodPerf,
    myActiveWorkPerf
  );

  const rows = members
    .map((m) => {
      const periodPerf = computePerf(m.assignedTasks);
      const openAssigned = m.assignedTasks.filter(
        (t) => t.status !== "DONE" && !isArchivedProjectStatus(t.project.status)
      );
      const activeAssigned = m.assignedTasks.filter(
        (t) => !isArchivedProjectStatus(t.project.status)
      );
      const activePerf = computePerf(activeAssigned);
      const perf = combinePeriodResultsWithActiveWork(periodPerf, activePerf);
      const delegated = m.createdTasks.filter(
        (t) =>
          t.assigneeId &&
          t.assigneeId !== m.id &&
          t.status !== "DONE" &&
          !isArchivedProjectStatus(t.project.status)
      );
      const rate =
        periodPerf.done > 0
          ? Math.round((periodPerf.onTime / periodPerf.done) * 100)
          : null;
      const biddingProjectCount = m.memberships.filter(
        (membership) => membership.project.status === "BIDDING"
      ).length;
      const onProcessProjectCount = m.memberships.filter(
        (membership) => membership.project.status === "ON_PROCESS"
      ).length;
      return {
        m,
        perf,
        periodPerf,
        openAssigned,
        delegated,
        rate,
        biddingProjectCount,
        onProcessProjectCount,
      };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));

  const inProgress = allOpenTasks.filter(
    (t) => t.status === "IN_PROGRESS"
  ).length;
  const overdueTotal = allOpenTasks.filter(
    (t) => t.dueDate && isOverdue(t.dueDate)
  ).length;
  const findLeaders = (
    valueOf: (row: (typeof rows)[number]) => number
  ): TeamHighlight => {
    const highest = Math.max(0, ...rows.map(valueOf));
    if (highest === 0) return null;
    return {
      value: highest,
      names: rows.filter((row) => valueOf(row) === highest).map((row) => row.m.name),
    };
  };
  const mostAssigned = findLeaders((row) => row.openAssigned.length);
  const mostOverdue = findLeaders((row) => row.perf.overdueOpen);
  const mostOnTime = findLeaders((row) => row.periodPerf.onTime);

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="team" />

      <main className="tf-main">
        <div className="tf-page space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-emerald-50 text-emerald-700">
                <TrendingUp size={20} aria-hidden="true" />
              </span>
              <div>
                <h1 className="tf-page-title">Hiệu suất</h1>
                <p className="mt-0.5 text-sm text-zinc-500">{period.label}</p>
              </div>
            </div>

            <nav
              aria-label="Chọn kỳ đánh giá"
              className="tf-scroll-tabs flex rounded-[8px] bg-zinc-100 p-1"
            >
              {PERFORMANCE_PERIOD_OPTIONS.map((option) => (
                <Link
                  key={option.key}
                  href={`/team?period=${option.key}`}
                  aria-current={period.key === option.key ? "page" : undefined}
                  className={`whitespace-nowrap rounded-[6px] px-3 py-1.5 text-sm transition-colors ${
                    period.key === option.key
                      ? "bg-white font-medium text-zinc-950 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800"
                  }`}
                >
                  {option.label}
                </Link>
              ))}
            </nav>
          </div>

          {isAdmin && (
            <div className="tf-panel grid overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-zinc-200">
              <div className="border-b border-zinc-200 p-4 sm:border-b-0">
                <p className="text-2xl font-bold">{allOpenTasks.length}</p>
                <p className="text-sm text-zinc-500">việc đang mở</p>
              </div>
              <div className="border-b border-zinc-200 p-4 sm:border-b-0">
                <p className="text-2xl font-bold text-blue-600">{inProgress}</p>
                <p className="text-sm text-zinc-500">đang làm</p>
              </div>
              <div className="p-4">
                <p className="text-2xl font-bold text-red-600">{overdueTotal}</p>
                <p className="text-sm text-zinc-500">quá hạn</p>
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-zinc-700">
                Điểm nổi bật nhân sự
              </h2>
              <div className="tf-panel grid overflow-hidden divide-y divide-zinc-200 md:grid-cols-3 md:divide-x md:divide-y-0">
                <HighlightCard
                  label="Đang nhận nhiều task nhất"
                  highlight={mostAssigned}
                  unit="task đang mở"
                  icon={Inbox}
                  iconClassName="bg-blue-50 text-blue-700"
                />
                <HighlightCard
                  label="Có nhiều task quá hạn nhất"
                  highlight={mostOverdue}
                  unit="task quá hạn"
                  icon={AlertTriangle}
                  iconClassName="bg-red-50 text-red-700"
                />
                <HighlightCard
                  label="Hoàn thành đúng hạn nhiều nhất"
                  highlight={mostOnTime}
                  unit="task đúng hạn"
                  icon={CheckCircle2}
                  iconClassName="bg-brand-50 text-brand-700"
                />
              </div>
            </section>
          )}

          <section className="tf-panel space-y-3 p-5">
            <h2 className="font-semibold">Hiệu suất của tôi</h2>
            <PerformanceBar perf={myPerf} periodLabel={period.label} />
          </section>

          {members.length > 0 && (
            <section className="tf-panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3">
                <div>
                  <h2 className="font-semibold">
                    {isAdmin ? "Nhân viên" : "Nhân viên của tôi"} (
                    {members.length})
                  </h2>
                </div>
              </div>

              <div className="hidden grid-cols-[minmax(220px,1.35fr)_minmax(180px,.9fr)_100px_76px_76px_28px] items-center gap-4 border-b border-zinc-100 bg-zinc-50/60 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 lg:grid">
                <span>Nhân viên</span>
                <span>Dự án tham gia</span>
                <span className="text-right">Đúng hạn</span>
                <span className="text-right">Đang mở</span>
                <span className="text-right">Quá hạn</span>
                <span />
              </div>

              <div className="divide-y divide-zinc-100">
                {rows.map(({
                  m,
                  perf,
                  openAssigned,
                  delegated,
                  rate,
                  biddingProjectCount,
                  onProcessProjectCount,
                }) => (
                  <details key={m.id} className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-zinc-50">
                      <span className="grid min-w-0 flex-1 grid-cols-3 items-center gap-x-4 gap-y-3 lg:grid-cols-[minmax(220px,1.35fr)_minmax(180px,.9fr)_100px_76px_76px]">
                        <span className="col-span-3 flex min-w-0 items-center gap-3 lg:col-span-1">
                          <Avatar
                            id={m.id}
                            name={m.name}
                            avatarUrl={m.avatarUrl}
                            className="h-9 w-9 text-xs"
                          />
                          <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {m.name}
                              </span>
                              <RoleBadge role={m.role} />
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-zinc-400 lg:hidden">
                              {m.email}
                            </span>
                          </span>
                        </span>
                        <span className="col-span-3 border-y border-zinc-100 py-2.5 lg:col-span-1 lg:border-0 lg:py-0">
                          <ProjectParticipation
                            bidding={biddingProjectCount}
                            onProcess={onProcessProjectCount}
                          />
                        </span>
                        <span className="text-left lg:text-right">
                          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-400 lg:hidden">
                            Đúng hạn
                          </span>
                          {rate !== null ? (
                            <>
                              <span
                                className={`block text-base font-semibold tabular-nums ${onTimeRateClass(rate)}`}
                              >
                                {rate}%
                              </span>
                              <span className="block text-[10px] tabular-nums text-zinc-400">
                                {perf.onTime}/{perf.done} task
                              </span>
                            </>
                          ) : (
                            <span className="text-sm text-zinc-400">Chưa có</span>
                          )}
                        </span>
                        <span className="text-center lg:text-right">
                          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-400 lg:hidden">
                            Đang mở
                          </span>
                          <span
                            className={`text-base font-medium tabular-nums ${
                              openAssigned.length > 0
                                ? "text-blue-600"
                                : "text-zinc-400"
                            }`}
                          >
                            {openAssigned.length}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-400 lg:hidden">
                            Quá hạn
                          </span>
                          <span
                            className={`text-base tabular-nums ${
                              perf.overdueOpen > 0
                                ? "font-semibold text-red-600"
                                : "font-medium text-zinc-400"
                            }`}
                          >
                            {perf.overdueOpen}
                          </span>
                        </span>
                      </span>
                      <ChevronDown
                        size={16}
                        className="shrink-0 text-zinc-300 transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>

                    <div className="space-y-4 border-t border-zinc-100 bg-zinc-50/50 px-5 py-4">
                      <div className="text-xs text-zinc-400">
                        {m.email}
                        {isAdmin && m.manager && ` · Quản lý: ${m.manager.name}`}
                        {" · "}Bidding: {biddingProjectCount}
                        {" · "}On Process: {onProcessProjectCount}
                      </div>
                      <PerformanceBar perf={perf} periodLabel={period.label} />

                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                          Việc được giao ({openAssigned.length} đang mở)
                        </p>
                        {openAssigned.length > 0 ? (
                          <div className="rounded-[8px] border border-zinc-200 bg-white px-2">
                            {openAssigned.map((t) => (
                              <TaskListItem
                                key={t.id}
                                task={{
                                  id: t.id,
                                  title: t.title,
                                  status: t.status,
                                  priority: t.priority,
                                  dueDate: t.dueDate,
                                  project: t.project,
                                  personLabel: `${t.creator.name} giao`,
                                }}
                              />
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-zinc-400">Không có.</p>
                        )}
                      </div>

                      {delegated.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                            Việc giao ra ({delegated.length} đang mở)
                          </p>
                          <div className="rounded-[8px] border border-zinc-200 bg-white px-2">
                            {delegated.map((t) => (
                              <TaskListItem
                                key={t.id}
                                task={{
                                  id: t.id,
                                  title: t.title,
                                  status: t.status,
                                  priority: t.priority,
                                  dueDate: t.dueDate,
                                  project: t.project,
                                  personLabel: t.assignee
                                    ? `${t.assignee.name} làm`
                                    : undefined,
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {members.length === 0 && !isAdmin && (
            <p className="text-sm text-zinc-400">
              Bạn chưa quản lý nhân viên nào.
            </p>
          )}

          {isAdmin && unassigned.length > 0 && (
            <section className="tf-panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-3">
                <AlertTriangle size={16} className="text-amber-600" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-amber-800">
                  Việc chưa gán cho ai ({unassigned.length})
                </h2>
              </div>
              <div className="px-2">
                {unassigned.map((t) => (
                  <TaskListItem
                    key={t.id}
                    task={{
                      id: t.id,
                      title: t.title,
                      status: t.status,
                      priority: t.priority,
                      dueDate: t.dueDate,
                      project: t.project,
                    }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
