import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { computePerf, type Perf } from "@/lib/performance";
import { isOverdue } from "@/lib/dates";
import Sidebar from "@/components/Sidebar";
import PerformanceBar from "@/components/PerformanceBar";
import TaskListItem from "@/components/TaskListItem";
import { avatarClass } from "@/lib/avatar";
import RoleBadge from "@/components/RoleBadge";
import { AlertTriangle, ChevronDown, TrendingUp } from "lucide-react";
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
    { value: perf.onTime, className: "bg-emerald-500" },
    { value: perf.late, className: "bg-amber-400" },
    { value: perf.overdueOpen, className: "bg-red-500" },
    { value: perf.open, className: "bg-zinc-300" },
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

export default async function TeamPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  const [members, myTasks, sidebarProjects, allOpenTasks, unassigned] =
    await Promise.all([
      // Admin thấy mọi nhân viên; quản lý thấy nhân viên trực tiếp của mình
      prisma.user.findMany({
        where: isAdmin ? { id: { not: user.id } } : { managerId: user.id },
        include: {
          assignedTasks: {
            include: taskInclude,
            orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
          },
          createdTasks: {
            include: taskInclude,
            orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
          },
          manager: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.task.findMany({
        where: { assigneeId: user.id },
        select: { status: true, dueDate: true, completedAt: true },
      }),
      prisma.project.findMany({
        where: { members: { some: { userId: user.id } } },
        select: { id: true, name: true, color: true, status: true },
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

  const myPerf = computePerf(myTasks);

  const rows = members
    .map((m) => {
      const perf = computePerf(m.assignedTasks);
      const openAssigned = m.assignedTasks.filter(
        (t) => t.status !== "DONE" && !isArchivedProjectStatus(t.project.status)
      );
      const delegated = m.createdTasks.filter(
        (t) =>
          t.assigneeId &&
          t.assigneeId !== m.id &&
          t.status !== "DONE" &&
          !isArchivedProjectStatus(t.project.status)
      );
      const rate =
        perf.total > 0 ? Math.round((perf.onTime / perf.total) * 100) : null;
      return { m, perf, openAssigned, delegated, rate };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));

  const inProgress = allOpenTasks.filter(
    (t) => t.status === "IN_PROGRESS"
  ).length;
  const overdueTotal = allOpenTasks.filter(
    (t) => t.dueDate && isOverdue(t.dueDate)
  ).length;

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="team" />

      <main className="tf-main">
        <div className="tf-page space-y-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-emerald-50 text-emerald-700">
              <TrendingUp size={20} aria-hidden="true" />
            </span>
            <h1 className="tf-page-title">Đội & Hiệu suất</h1>
          </div>

          {isAdmin && (
            <div className="grid grid-cols-3 gap-4">
              <div className="tf-panel p-4">
                <p className="text-2xl font-bold">{allOpenTasks.length}</p>
                <p className="text-sm text-zinc-500">việc đang mở</p>
              </div>
              <div className="tf-panel p-4">
                <p className="text-2xl font-bold text-blue-600">{inProgress}</p>
                <p className="text-sm text-zinc-500">đang làm</p>
              </div>
              <div className="tf-panel p-4">
                <p className="text-2xl font-bold text-red-600">{overdueTotal}</p>
                <p className="text-sm text-zinc-500">quá hạn</p>
              </div>
            </div>
          )}

          <section className="tf-panel space-y-3 p-5">
            <h2 className="font-semibold">Hiệu suất của tôi</h2>
            <PerformanceBar perf={myPerf} />
          </section>

          {members.length > 0 && (
            <section className="tf-panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3">
                <h2 className="font-semibold">
                  {isAdmin ? "Nhân viên" : "Nhân viên của tôi"} (
                  {members.length})
                </h2>
                <span className="text-xs text-zinc-400">
                  Bấm vào từng người để xem chi tiết
                </span>
              </div>

              <div className="hidden grid-cols-[minmax(0,1fr)_150px_76px_76px_76px_28px] gap-3 border-b border-zinc-100 bg-zinc-50/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 sm:grid">
                <span>Nhân viên</span>
                <span>Hiệu suất</span>
                <span className="text-right">Đúng hạn</span>
                <span className="text-right">Đang mở</span>
                <span className="text-right">Quá hạn</span>
                <span />
              </div>

              <div className="divide-y divide-zinc-100">
                {rows.map(({ m, perf, openAssigned, delegated, rate }) => (
                  <details key={m.id} className="group">
                    <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_28px] items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50 sm:grid-cols-[minmax(0,1fr)_150px_76px_76px_76px_28px]">
                      <span className="flex min-w-0 items-center gap-3" title={m.email}>
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarClass(m.id)}`}
                        >
                          {m.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="truncate text-sm font-medium">
                          {m.name}
                          <RoleBadge role={m.role} />
                        </span>
                      </span>
                      <span className="hidden sm:block">
                        <PerfMini perf={perf} />
                      </span>
                      <span className="hidden text-right text-sm font-semibold text-zinc-700 sm:block">
                        {rate !== null ? `${rate}%` : "—"}
                      </span>
                      <span className="hidden text-right text-sm text-zinc-600 sm:block">
                        {openAssigned.length}
                      </span>
                      <span
                        className={`hidden text-right text-sm sm:block ${
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
                      </div>
                      <PerformanceBar perf={perf} />

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
