import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  combinePeriodResultsWithActiveWork,
  computePerf,
  getPerformancePeriod,
  PERFORMANCE_PERIOD_OPTIONS,
  type Perf,
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

/** Thanh hiệu suất thu nhỏ cho từng dòng trong bảng */
function PerfMini({ perf }: { perf: Perf }) {
  if (perf.total === 0) {
    return <span className="text-xs text-zinc-300">Chưa có task</span>;
  }
  const segments = [
    { value: perf.onTime, className: "bg-brand-400" },
    { value: perf.late, className: "bg-amber-400" },
    { value: perf.overdueOpen, className: "bg-red-500" },
    { value: perf.inProgress, className: "bg-blue-500" },
    { value: perf.todo, className: "bg-zinc-300" },
  ];
  return (
    <div className="flex h-2 w-full max-w-[140px] overflow-hidden rounded-full bg-zinc-100">
      {segments.map(
        (s, i) =>
          s.value > 0 && (
            <div
              key={i}
              className={s.className}
              style={{ width: `${(s.value / perf.total) * 100}%` }}
            />
          )
      )}
    </div>
  );
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
        where: isAdmin ? { id: { not: user.id } } : { managerId: user.id },
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
          account: {
            select: { team: { select: { id: true, name: true } } },
          },
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
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Tỷ lệ đúng hạn = task đúng hạn / tổng task hoàn thành trong kỳ.
                  </p>
                </div>
                <span className="text-xs text-zinc-400">
                  Bấm vào từng người để xem chi tiết
                </span>
              </div>

              <div className="hidden grid-cols-[minmax(0,1fr)_130px_64px_72px_76px_76px_76px_28px] gap-3 border-b border-zinc-100 bg-zinc-50/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 lg:grid">
                <span>Nhân viên</span>
                <span>Hiệu suất</span>
                <span className="text-right">Bidding</span>
                <span className="text-right">On Process</span>
                <span className="text-right">Tỷ lệ đúng hạn</span>
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
                    <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_28px] items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50 lg:grid-cols-[minmax(0,1fr)_130px_64px_72px_76px_76px_76px_28px]">
                      <span className="flex min-w-0 items-center gap-3" title={m.email}>
                        <Avatar
                          id={m.id}
                          name={m.name}
                          avatarUrl={m.avatarUrl}
                          className="h-8 w-8 text-xs"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {m.name}
                            <RoleBadge role={m.role} />
                          </span>
                          <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-400 lg:hidden">
                            Bidding {biddingProjectCount} · On Process{" "}
                            {onProcessProjectCount}
                          </span>
                        </span>
                      </span>
                      <span className="hidden lg:block">
                        <PerfMini perf={perf} />
                      </span>
                      <span className="hidden text-right text-sm font-medium tabular-nums text-amber-600 lg:block">
                        {biddingProjectCount}
                      </span>
                      <span className="hidden text-right text-sm font-medium tabular-nums text-blue-600 lg:block">
                        {onProcessProjectCount}
                      </span>
                      <span className="hidden text-right lg:block">
                        {rate !== null ? (
                          <>
                            <span className="block text-sm font-semibold text-zinc-700">
                              {rate}%
                            </span>
                            <span className="block text-[10px] tabular-nums text-zinc-400">
                              {perf.onTime}/{perf.done} task
                            </span>
                          </>
                        ) : (
                          <span className="text-sm text-zinc-400">—</span>
                        )}
                      </span>
                      <span className="hidden text-right text-sm text-zinc-600 lg:block">
                        {openAssigned.length}
                      </span>
                      <span
                        className={`hidden text-right text-sm lg:block ${
                          perf.overdueOpen > 0
                            ? "font-semibold text-red-600"
                            : "text-zinc-400"
                        }`}
                      >
                        {perf.overdueOpen}
                      </span>
                      <ChevronDown
                        size={16}
                        className="justify-self-end text-zinc-300 transition-transform group-open:rotate-180"
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
