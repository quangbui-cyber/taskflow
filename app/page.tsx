import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Plus,
  Search,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { canManageProjects, requireUser } from "@/lib/auth";
import { daysUntil, isOverdue } from "@/lib/dates";
import Sidebar from "@/components/Sidebar";
import TaskListItem, { type TaskListItemData } from "@/components/TaskListItem";
import DashboardSort from "@/components/DashboardSort";
import {
  ARCHIVED_PROJECT_STATUS_KEYS,
  formatVND,
  isArchivedProjectStatus,
} from "@/lib/types";

type DashboardView = "overview" | "mine" | "delegated";

const DASHBOARD_VIEWS: Array<{
  key: DashboardView;
  label: string;
}> = [
  { key: "overview", label: "Tổng quan" },
  { key: "mine", label: "Của tôi" },
  { key: "delegated", label: "Đã giao" },
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
  searchParams: Promise<{ q?: string; sort?: string; view?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const query = params.q?.trim().toLocaleLowerCase("vi") ?? "";
  const sort = params.sort === "project" ? "project" : "due";
  const activeView: DashboardView =
    params.view === "mine" || params.view === "delegated"
      ? params.view
      : "overview";

  const taskInclude = {
    project: { select: { id: true, name: true, color: true } },
    assignee: { select: { name: true } },
    creator: { select: { name: true } },
  } as const;

  const [projects, assignedToMe, delegatedByMe] = await Promise.all([
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
      include: {
        _count: { select: { tasks: true, members: true } },
        tasks: { where: { status: "DONE" }, select: { id: true } },
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
  ]);

  const matchesQuery = (title: string, projectName: string) =>
    !query ||
    title.toLocaleLowerCase("vi").includes(query) ||
    projectName.toLocaleLowerCase("vi").includes(query);

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

  const visibleAssigned = sortTasks(
    assignedToMe.filter((task) => matchesQuery(task.title, task.project.name))
  );
  const visibleDelegated = sortTasks(
    delegatedByMe.filter((task) => matchesQuery(task.title, task.project.name))
  );
  const visibleProjects = projects.filter(
    (project) =>
      !isArchivedProjectStatus(project.status) &&
      (!query ||
        project.name.toLocaleLowerCase("vi").includes(query) ||
        project.description?.toLocaleLowerCase("vi").includes(query))
  );
  const groupedVisibleProjects = ACTIVE_PROJECT_GROUPS.map((group) => ({
    ...group,
    projects: visibleProjects.filter((project) => project.status === group.status),
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
    if (params.q?.trim()) next.set("q", params.q.trim());
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
        : visibleAssigned.length + visibleDelegated.length;
  const noTaskResults = query && currentViewTaskCount === 0;

  return (
    <div className="tf-shell">
      <Sidebar
        user={user}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          color: project.color,
          status: project.status,
        }))}
        activeSection="home"
      />

      <main className="tf-main bg-white">
        <div className="flex min-h-[72px] items-center justify-between gap-4 border-b border-zinc-200 bg-white px-4 py-3 sm:px-6">
          <form action="/" className="relative w-full max-w-[360px]">
            {sort !== "due" && <input type="hidden" name="sort" value={sort} />}
            {activeView !== "overview" && (
              <input type="hidden" name="view" value={activeView} />
            )}
            <Search
              size={17}
              strokeWidth={1.8}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <input
              name="q"
              defaultValue={params.q ?? ""}
              className="tf-field !min-h-10 !pl-10 !pr-14"
              placeholder="Tìm công việc hoặc dự án"
              aria-label="Tìm công việc hoặc dự án"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-400 sm:block">
              Enter
            </span>
          </form>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden sm:inline-flex">
              <Link
                href="/notifications"
                className="tf-icon-button"
                title="Trợ giúp và thông báo"
                aria-label="Trợ giúp và thông báo"
                prefetch={false}
              >
                <CircleHelp size={18} strokeWidth={1.8} aria-hidden="true" />
              </Link>
            </span>
            {showRevenue && (
              <Link href="/projects/new" prefetch={false} className="tf-button-primary">
                <Plus size={18} strokeWidth={2} aria-hidden="true" />
                <span className="hidden sm:inline">Tạo dự án</span>
                <span className="sm:hidden">Tạo</span>
              </Link>
            )}
          </div>
        </div>

        <div className="grid min-h-[calc(100vh-72px)] lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 px-4 py-8 sm:px-8 lg:px-10">
            <div className="mx-auto max-w-3xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="tf-page-title">Công việc</h1>
                  <p className="tf-page-subtitle first-letter:uppercase">{dateLabel}</p>
                </div>
                <DashboardSort value={sort} />
              </div>

              <nav
                className="mt-8 inline-flex rounded-[8px] bg-zinc-100 p-1"
                aria-label="Bộ lọc công việc"
              >
                {DASHBOARD_VIEWS.map((view) => {
                  const active = activeView === view.key;
                  const count =
                    view.key === "mine"
                      ? visibleAssigned.length
                      : view.key === "delegated"
                        ? visibleDelegated.length
                        : priorityTasks.length;

                  return (
                    <Link
                      key={view.key}
                      href={tabHref(view.key)}
                      prefetch={false}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex min-h-9 items-center gap-2 rounded-[7px] px-3 text-sm font-medium transition-colors ${
                        active
                          ? "bg-white text-zinc-950 shadow-sm"
                          : "text-zinc-500 hover:text-zinc-800"
                      }`}
                    >
                      {view.label}
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

              {noTaskResults && (
                <div className="mt-8 rounded-[8px] border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
                  Không tìm thấy công việc phù hợp với “{params.q}”.
                </div>
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
                                    <h4 className="truncate text-sm font-semibold text-zinc-900 group-hover:text-brand-700">
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
                                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-400">
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
