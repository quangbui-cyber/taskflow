import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Plus,
  UsersRound,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { canManageProjects, requireUser } from "@/lib/auth";
import { daysUntil, isOverdue } from "@/lib/dates";
import Sidebar from "@/components/Sidebar";
import Avatar from "@/components/Avatar";
import TaskListItem, { type TaskListItemData } from "@/components/TaskListItem";
import DashboardSort from "@/components/DashboardSort";
import DailyInspiration from "@/components/DailyInspiration";
import PerformanceBar from "@/components/PerformanceBar";
import { computePerf } from "@/lib/performance";
import { getDailyInspiration } from "@/lib/daily-inspiration";
import {
  ARCHIVED_PROJECT_STATUS_KEYS,
  formatVND,
  isArchivedProjectStatus,
} from "@/lib/types";

type DashboardView = "overview" | "mine" | "delegated" | "following" | "team";

const DASHBOARD_VIEWS: Array<{
  key: DashboardView;
  label: string;
  compactLabel?: string;
}> = [
  { key: "overview", label: "Tổng quan" },
  { key: "mine", label: "Của tôi" },
  { key: "delegated", label: "Đã giao" },
  { key: "following", label: "Đang theo dõi", compactLabel: "Theo dõi" },
];

const ACTIVE_PROJECT_GROUPS = [
  {
    status: "ON_PROCESS",
    label: "On Process",
    dotClassName: "bg-blue-500",
    barClassName: "bg-blue-500",
    badgeClassName: "bg-blue-100 text-blue-700",
  },
  {
    status: "BIDDING",
    label: "Bidding",
    dotClassName: "bg-amber-500",
    barClassName: "bg-amber-500",
    badgeClassName: "bg-amber-100 text-amber-700",
  },
] as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; view?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const sort = params.sort === "project" ? "project" : "due";
  const requestedView: DashboardView =
    params.view === "mine" ||
    params.view === "delegated" ||
    params.view === "following" ||
    params.view === "team"
      ? params.view
      : "overview";

  const taskInclude = {
    project: { select: { id: true, name: true, color: true, status: true } },
    assignee: { select: { name: true } },
    creator: { select: { name: true } },
  } as const;

  const [projects, assignedToMe, delegatedByMe, followedTasks, directReports] = await Promise.all([
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
      include: {
        _count: { select: { tasks: true, members: true } },
        tasks: { where: { status: "DONE" }, select: { id: true } },
        account: {
          select: { team: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.task.findMany({
      where: {
        assigneeId: user.id,
        status: { not: "DONE" },
        project: {
          status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] },
          members: { some: { userId: user.id } },
        },
      },
      include: taskInclude,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
    }),
    prisma.task.findMany({
      where: {
        creatorId: user.id,
        status: { not: "DONE" },
        assigneeId: { not: null },
        NOT: { assigneeId: user.id },
        project: {
          status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] },
          members: { some: { userId: user.id } },
        },
      },
      include: taskInclude,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
    }),
    prisma.task.findMany({
      where: {
        followers: { some: { userId: user.id } },
        status: { not: "DONE" },
        project: {
          status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] },
          members: { some: { userId: user.id } },
        },
      },
      include: taskInclude,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
    }),
    prisma.user.findMany({
      where: { managerId: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        assignedTasks: {
          where: {
            project: {
              status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] },
            },
          },
          include: taskInclude,
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const activeView: DashboardView =
    requestedView === "team" && directReports.length === 0
      ? "overview"
      : requestedView;
  const dashboardViews =
    directReports.length > 0
      ? [
          ...DASHBOARD_VIEWS,
          {
            key: "team" as const,
            label: "Nhân viên của tôi",
            compactLabel: "Nhân viên",
          },
        ]
      : DASHBOARD_VIEWS;

  const sortTasks = <T extends { project: { name: string }; dueDate: Date | null }>(
    tasks: T[]
  ) =>
    [...tasks].sort((a, b) => {
      if (sort === "project") {
        return a.project.name.localeCompare(b.project.name, "vi");
      }
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
    });

  const visibleAssigned = sortTasks(assignedToMe);
  const visibleDelegated = sortTasks(delegatedByMe);
  const visibleFollowing = sortTasks(
    followedTasks.filter(
      (task) =>
        task.assigneeId !== user.id &&
        task.creatorId !== user.id
    )
  );
  const visibleReports = directReports
    .map((report) => {
      const tasks = sortTasks(report.assignedTasks);
      const openTasks = tasks.filter((task) => task.status !== "DONE");
      const completedTasks = tasks.filter((task) => task.status === "DONE");
      return {
        ...report,
        tasks,
        openTasks,
        completedTasks,
        perf: computePerf(report.assignedTasks),
      };
    });
  const visibleProjects = projects.filter(
    (project) => !isArchivedProjectStatus(project.status)
  );
  const groupedVisibleProjects = ACTIVE_PROJECT_GROUPS.map((group) => ({
    ...group,
    projects: visibleProjects
      .filter((project) => project.status === group.status)
      .sort((a, b) =>
        a.name.localeCompare(b.name, "vi", { sensitivity: "base" })
      ),
  }));

  const overdue = visibleAssigned.filter(
    (task) => task.dueDate && isOverdue(task.dueDate)
  );
  const dueSoon = visibleAssigned.filter(
    (task) =>
      task.dueDate && !isOverdue(task.dueDate) && daysUntil(task.dueDate) <= 3
  );
  const priorityTaskIds = new Set(
    [...overdue, ...dueSoon].map((task) => task.id)
  );
  const regularAssigned = visibleAssigned.filter(
    (task) => !priorityTaskIds.has(task.id)
  );
  const priorityTasks = [...overdue, ...dueSoon];
  const showRevenue = canManageProjects(user.role);
  const dailyInspiration = getDailyInspiration(user.id);

  const toItem = (
    task: (typeof assignedToMe)[number],
    person?: string
  ): TaskListItemData => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    project: task.project,
    personLabel: person,
  });

  const dateLabel = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
  const tabHref = (view: DashboardView) => {
    const next = new URLSearchParams();
    if (sort !== "due") next.set("sort", sort);
    if (view !== "overview") next.set("view", view);
    const qs = next.toString();
    return qs ? `/?${qs}` : "/";
  };
  const currentViewTaskCount =
    activeView === "mine"
      ? visibleAssigned.length
      : activeView === "delegated"
        ? visibleDelegated.length
        : activeView === "following"
          ? visibleFollowing.length
          : activeView === "team"
            ? visibleReports.reduce((total, report) => total + report.tasks.length, 0)
            : visibleAssigned.length + visibleDelegated.length;
  return (
    <div className="tf-shell">
      <Sidebar
        user={user}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          color: project.color,
          status: project.status,
          account: project.account,
        }))}
        activeSection="home"
      />

      <main className="tf-main bg-white">
        <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 px-4 py-8 sm:px-8 lg:px-10">
            <div className="mx-auto max-w-3xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="tf-page-title">Công việc</h1>
                  <p className="tf-page-subtitle first-letter:uppercase">{dateLabel}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <DashboardSort value={sort} />
                  {showRevenue && (
                    <Link href="/projects/new" prefetch={false} className="tf-button-primary">
                      <Plus size={18} strokeWidth={2} aria-hidden="true" />
                      <span className="hidden sm:inline">Tạo dự án</span>
                      <span className="sm:hidden">Tạo</span>
                    </Link>
                  )}
                </div>
              </div>

              <DailyInspiration
                quote={dailyInspiration.quote}
                dateLabel={dailyInspiration.dateLabel}
                dismissKey={dailyInspiration.dismissKey}
              />

              <nav
                className="tf-scroll-tabs mt-6 flex w-fit rounded-[8px] bg-zinc-100 p-1"
                aria-label="Bộ lọc công việc"
              >
                {dashboardViews.map((view) => {
                  const active = activeView === view.key;
                  const count =
                    view.key === "mine"
                      ? visibleAssigned.length
                      : view.key === "delegated"
                        ? visibleDelegated.length
                        : view.key === "following"
                          ? visibleFollowing.length
                          : view.key === "team"
                            ? directReports.length
                            : priorityTasks.length;

                  return (
                    <Link
                      key={view.key}
                      href={tabHref(view.key)}
                      prefetch={false}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-1.5 text-xs font-medium transition-colors 2xl:gap-2 2xl:px-3 2xl:text-sm ${
                        active
                          ? "bg-white text-zinc-950 shadow-sm"
                          : "text-zinc-500 hover:text-zinc-800"
                      }`}
                    >
                      <span className={view.compactLabel ? "hidden 2xl:inline" : undefined}>
                        {view.label}
                      </span>
                      {view.compactLabel && (
                        <span className="2xl:hidden">{view.compactLabel}</span>
                      )}
                      {count > 0 && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                            active ? "bg-zinc-100 text-zinc-600" : "bg-white/80 text-zinc-500"
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>

              {activeView === "overview" && (
                <>
                  <section className="mt-10" aria-labelledby="priority-heading">
                    <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
                      <h2 id="priority-heading" className="text-base font-semibold text-zinc-900">
                        Ưu tiên hôm nay
                      </h2>
                      {priorityTasks.length > 0 && (
                        <span className={`text-sm font-medium ${overdue.length > 0 ? "text-red-600" : "text-amber-700"}`}>
                          {overdue.length > 0
                            ? `${overdue.length} quá hạn${dueSoon.length > 0 ? `, ${dueSoon.length} sắp đến hạn` : ""}`
                            : `${dueSoon.length} việc sắp đến hạn`}
                        </span>
                      )}
                    </div>
                    {priorityTasks.length > 0 ? (
                      <div>
                        {priorityTasks.map((task) => (
                          <TaskListItem key={task.id} task={toItem(task, `${task.creator.name} giao`)} />
                        ))}
                      </div>
                    ) : (
                      <div className="flex min-h-24 items-center gap-3 text-sm text-zinc-400">
                        <CheckCircle2 size={20} className="text-emerald-500" aria-hidden="true" />
                        Không có việc khẩn cấp cần xử lý.
                      </div>
                    )}
                  </section>

                  <section id="my-tasks" className="mt-10 scroll-mt-6" aria-labelledby="assigned-heading">
                    <div className="border-b border-zinc-200 pb-3">
                      <h2 id="assigned-heading" className="text-base font-semibold text-zinc-900">
                        Việc còn lại của tôi ({regularAssigned.length})
                      </h2>
                    </div>
                    {regularAssigned.length > 0 ? (
                      <div>
                        {regularAssigned.map((task) => (
                          <TaskListItem key={task.id} task={toItem(task, `${task.creator.name} giao`)} />
                        ))}
                      </div>
                    ) : (
                      <p className="py-6 text-sm text-zinc-400">Không có công việc nào ngoài nhóm ưu tiên.</p>
                    )}
                  </section>

                  <section id="delegated" className="mt-10 scroll-mt-6" aria-labelledby="delegated-heading">
                    <div className="border-b border-zinc-200 pb-3">
                      <h2 id="delegated-heading" className="text-base font-semibold text-zinc-900">
                        Việc tôi giao cho người khác ({visibleDelegated.length})
                      </h2>
                    </div>
                    {visibleDelegated.length > 0 ? (
                      <div>
                        {visibleDelegated.map((task) => (
                          <TaskListItem
                            key={task.id}
                            task={toItem(
                              task,
                              task.assignee ? `${task.assignee.name} làm` : undefined
                            )}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="py-6 text-sm text-zinc-400">Không có công việc nào.</p>
                    )}
                  </section>
                </>
              )}

              {activeView === "mine" && (
                <section id="my-tasks" className="mt-10" aria-labelledby="assigned-heading">
                  <div className="border-b border-zinc-200 pb-3">
                    <h2 id="assigned-heading" className="text-base font-semibold text-zinc-900">
                      Việc của tôi ({visibleAssigned.length})
                    </h2>
                  </div>
                  {visibleAssigned.length > 0 ? (
                    <div>
                      {visibleAssigned.map((task) => (
                        <TaskListItem key={task.id} task={toItem(task, `${task.creator.name} giao`)} />
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-sm text-zinc-400">Không có công việc nào.</p>
                  )}
                </section>
              )}

              {activeView === "delegated" && (
                <section id="delegated" className="mt-10" aria-labelledby="delegated-heading">
                  <div className="border-b border-zinc-200 pb-3">
                    <h2 id="delegated-heading" className="text-base font-semibold text-zinc-900">
                      Đã giao ({visibleDelegated.length})
                    </h2>
                  </div>
                  {visibleDelegated.length > 0 ? (
                    <div>
                      {visibleDelegated.map((task) => (
                        <TaskListItem
                          key={task.id}
                          task={toItem(
                            task,
                            task.assignee ? `${task.assignee.name} làm` : undefined
                          )}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-sm text-zinc-400">Không có công việc nào.</p>
                  )}
                </section>
              )}

              {activeView === "following" && (
                <section className="mt-10" aria-labelledby="following-heading">
                  <div className="border-b border-zinc-200 pb-3">
                    <h2 id="following-heading" className="text-base font-semibold text-zinc-900">
                      Đang theo dõi ({visibleFollowing.length})
                    </h2>
                    <p className="mt-1 text-xs text-zinc-400">
                      Các công việc bạn theo dõi nhưng không trực tiếp làm hoặc giao.
                    </p>
                  </div>
                  {visibleFollowing.length > 0 ? (
                    <div>
                      {visibleFollowing.map((task) => (
                        <TaskListItem
                          key={task.id}
                          task={toItem(
                            task,
                            task.assignee
                              ? `${task.assignee.name} phụ trách`
                              : "Chưa có người phụ trách"
                          )}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-sm text-zinc-400">
                      Chưa có công việc nào cần theo dõi riêng.
                    </p>
                  )}
                </section>
              )}

              {activeView === "team" && (
                <section className="mt-10" aria-labelledby="team-report-heading">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
                    <div>
                      <h2 id="team-report-heading" className="text-base font-semibold text-zinc-900">
                        Báo cáo công việc của nhân viên
                      </h2>
                      <p className="mt-1 text-xs text-zinc-400">
                        {directReports.length} nhân viên trực thuộc · {currentViewTaskCount} task
                      </p>
                    </div>
                    <UsersRound size={19} className="text-zinc-400" aria-hidden="true" />
                  </div>

                  {visibleReports.length > 0 ? (
                    <div className="divide-y divide-zinc-200">
                      {visibleReports.map((report) => (
                        <details key={report.id} open className="group/report py-1">
                          <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-1 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] sm:px-3">
                            <span className="flex min-w-0 items-center gap-3">
                              <Avatar
                                id={report.id}
                                name={report.name}
                                avatarUrl={report.avatarUrl}
                                className="h-9 w-9 text-xs"
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-zinc-900">
                                  {report.name}
                                </span>
                                <span className="block truncate text-xs text-zinc-400">
                                  {report.email}
                                </span>
                              </span>
                            </span>
                            <span className="hidden text-right text-xs text-zinc-500 sm:block">
                              <strong className="block text-sm text-zinc-800">{report.openTasks.length}</strong>
                              đang mở
                            </span>
                            <span className={`hidden text-right text-xs sm:block ${report.perf.overdueOpen > 0 ? "text-red-600" : "text-zinc-400"}`}>
                              <strong className="block text-sm">{report.perf.overdueOpen}</strong>
                              quá hạn
                            </span>
                            <span className="hidden text-right text-xs text-zinc-500 sm:block">
                              <strong className="block text-sm text-zinc-800">{report.perf.onTime}</strong>
                              đúng hạn
                            </span>
                            <ChevronDown
                              size={16}
                              className="text-zinc-300 transition-transform group-open/report:rotate-180"
                              aria-hidden="true"
                            />
                          </summary>

                          <div className="space-y-6 bg-zinc-50/60 px-3 py-5 sm:px-5">
                            <PerformanceBar perf={report.perf} />

                            <div>
                              <h3 className="mb-1 text-xs font-semibold uppercase text-zinc-400">
                                Đang thực hiện ({report.openTasks.length})
                              </h3>
                              {report.openTasks.length > 0 ? (
                                <div className="bg-white px-2">
                                  {report.openTasks.map((task) => (
                                    <TaskListItem
                                      key={task.id}
                                      task={toItem(task, `${report.name} phụ trách`)}
                                    />
                                  ))}
                                </div>
                              ) : (
                                <p className="py-3 text-sm text-zinc-400">Không có công việc đang mở.</p>
                              )}
                            </div>

                            <div>
                              <h3 className="mb-1 text-xs font-semibold uppercase text-zinc-400">
                                Đã hoàn thành ({report.completedTasks.length})
                              </h3>
                              {report.completedTasks.length > 0 ? (
                                <div className="bg-white px-2">
                                  {report.completedTasks.map((task) => (
                                    <TaskListItem
                                      key={task.id}
                                      task={toItem(task, `${report.name} hoàn thành`)}
                                    />
                                  ))}
                                </div>
                              ) : (
                                <p className="py-3 text-sm text-zinc-400">Chưa có công việc hoàn thành.</p>
                              )}
                            </div>
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <p className="py-8 text-sm text-zinc-400">Không có báo cáo phù hợp.</p>
                  )}
                </section>
              )}

            </div>
          </div>

          <aside id="projects" className="border-t border-zinc-200 bg-zinc-50/40 px-5 py-8 lg:border-l lg:border-t-0">
            <div className="mx-auto max-w-xl lg:sticky lg:top-8">
              <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">Dự án đang chạy</h2>
                  <span className="tf-badge bg-zinc-200/70 text-zinc-600">{visibleProjects.length}</span>
                </div>
                <ChevronRight size={18} className="text-zinc-400" aria-hidden="true" />
              </div>

              <div>
                {groupedVisibleProjects.map((group) =>
                  group.projects.length > 0 ? (
                    <details key={group.status} open className="group/status pt-5">
                      <summary className="flex cursor-pointer list-none items-center gap-2 pb-1 [&::-webkit-details-marker]:hidden">
                        <span
                          className={`h-3 w-1 rounded-full ${group.dotClassName}`}
                          aria-hidden="true"
                        />
                        <h3 className="text-xs font-semibold uppercase text-zinc-500">
                          {group.label}
                        </h3>
                        <span className="text-xs text-zinc-400">
                          {group.projects.length}
                        </span>
                        <ChevronDown
                          size={15}
                          className="ml-auto text-zinc-400 transition-transform group-open/status:rotate-180"
                          aria-hidden="true"
                        />
                      </summary>
                      <div className="divide-y divide-zinc-200">
                        {group.projects.map((project) => {
                          const done = project.tasks.length;
                          const total = project._count.tasks;
                          const percent =
                            total > 0 ? Math.round((done / total) * 100) : 0;
                          return (
                            <Link
                              key={project.id}
                              href={`/projects/${project.id}`}
                              prefetch={false}
                              className="group block py-6"
                            >
                              <div className="flex items-start gap-3">
                                <span
                                  className={`mt-1 h-3 w-3 shrink-0 rounded-full ${group.dotClassName}`}
                                  aria-hidden="true"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <h4 className="line-clamp-2 text-sm font-semibold text-zinc-900 group-hover:text-brand-700 sm:truncate">
                                      {project.name}
                                    </h4>
                                    <span
                                      className={`tf-badge shrink-0 ${group.badgeClassName}`}
                                    >
                                      {group.label}
                                    </span>
                                  </div>
                                  {showRevenue && project.revenue > 0 && (
                                    <p className="mt-4 text-sm font-semibold text-zinc-600">
                                      {formatVND(project.revenue)}
                                    </p>
                                  )}
                                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-200">
                                    <div
                                      className={`h-full rounded-full transition-all ${group.barClassName}`}
                                      style={{ width: `${percent}%` }}
                                    />
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-zinc-400">
                                    <span>{done}/{total} task hoàn thành</span>
                                    <span>{project._count.members} thành viên</span>
                                  </div>
                                </div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </details>
                  ) : null
                )}
                {visibleProjects.length === 0 && (
                  <p className="py-8 text-sm text-zinc-400">Không tìm thấy dự án phù hợp.</p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
