import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { canCreateProjects, canViewRevenue, requireUser } from "@/lib/auth";
import { projectResponsibilityGroup } from "@/lib/projectResponsibility";
import {
  ARCHIVED_PROJECT_STATUS_KEYS,
  formatVND,
  projectCategoryInfo,
  projectStatusInfo,
} from "@/lib/types";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";

type ProjectView = "active" | "archived";

const PROJECT_STATUS_ORDER: Record<string, number> = { ON_PROCESS: 0, BIDDING: 1 };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const view: ProjectView = params.view === "archived" ? "archived" : "active";
  const archivedStatuses = [...ARCHIVED_PROJECT_STATUS_KEYS];
  const memberOf = { members: { some: { userId: user.id } } };

  const [projects, activeCount, archivedCount] = await Promise.all([
    prisma.project.findMany({
      where: {
        ...memberOf,
        status: view === "archived" ? { in: archivedStatuses } : { notIn: archivedStatuses },
      },
      select: {
        id: true,
        name: true,
        status: true,
        category: true,
        revenue: true,
        responsibleTeam: { select: { id: true, name: true } },
        responsibleGroup: { select: { id: true, name: true } },
        account: { select: { team: { select: { id: true, name: true } } } },
        _count: { select: { tasks: true, members: true } },
        tasks: { where: { status: "DONE" }, select: { id: true } },
      },
    }),
    prisma.project.count({ where: { ...memberOf, status: { notIn: archivedStatuses } } }),
    prisma.project.count({ where: { ...memberOf, status: { in: archivedStatuses } } }),
  ]);

  const showRevenue = canViewRevenue(user.role);
  const groups = new Map<string, { id: string; name: string; projects: typeof projects }>();
  for (const project of projects) {
    const team = projectResponsibilityGroup(project);
    const group = groups.get(team.id) ?? { ...team, projects: [] };
    group.projects.push(project);
    groups.set(team.id, group);
  }
  const teams = [...groups.values()].sort((a, b) => {
    const aUnassigned = a.id === "unassigned" || a.id === "needs-account";
    const bUnassigned = b.id === "unassigned" || b.id === "needs-account";
    if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
    return a.name.localeCompare(b.name, "vi");
  });
  for (const team of teams) {
    team.projects.sort(
      (a, b) =>
        (PROJECT_STATUS_ORDER[a.status] ?? 9) - (PROJECT_STATUS_ORDER[b.status] ?? 9) ||
        a.name.localeCompare(b.name, "vi", { sensitivity: "base" })
    );
  }

  const tabs = [
    { key: "active" as const, label: "Đang chạy", count: activeCount, href: "/projects" },
    { key: "archived" as const, label: "Lưu trữ", count: archivedCount, href: "/projects?view=archived" },
  ];

  return (
    <div className="tf-shell">
      <Sidebar user={user} activeSection="projects" />

      <main className="tf-main bg-zinc-50">
        <HubTabs section="projects" role={user.role} />
        <div className="tf-page space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="tf-page-title">Dự án</h1>
              <nav className="mt-4 flex w-fit rounded-[8px] bg-zinc-200/70 p-1" aria-label="Trạng thái dự án">
                {tabs.map((tab) => (
                  <Link
                    key={tab.key}
                    href={tab.href}
                    prefetch={false}
                    aria-current={view === tab.key ? "page" : undefined}
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-[7px] px-3 text-sm font-medium transition-colors ${
                      view === tab.key ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                    }`}
                  >
                    {tab.label}
                    <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] tabular-nums text-zinc-600">
                      {tab.count}
                    </span>
                  </Link>
                ))}
              </nav>
            </div>
            {canCreateProjects(user.role) && (
              <Link href="/projects/new" prefetch={false} className="tf-button-primary">
                <Plus size={18} strokeWidth={2} aria-hidden="true" />
                Tạo dự án
              </Link>
            )}
          </div>

          {teams.length === 0 ? (
            <p className="rounded-[14px] border border-zinc-200 bg-white px-5 py-8 text-sm text-zinc-600">
              {view === "archived" ? "Chưa có dự án nào trong lưu trữ." : "Bạn chưa tham gia dự án nào đang chạy."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-[14px] border border-zinc-200 bg-white">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-600">
                    <th scope="col" className="px-5 py-3 font-semibold">Dự án</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Trạng thái</th>
                    <th scope="col" className="w-52 px-3 py-3 font-semibold">Tiến độ</th>
                    {showRevenue && <th scope="col" className="px-3 py-3 text-right font-semibold">Doanh thu</th>}
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Thành viên</th>
                  </tr>
                </thead>
                {teams.map((team) => (
                  <tbody key={team.id}>
                    <tr className="bg-zinc-50">
                      <th
                        scope="colgroup"
                        colSpan={showRevenue ? 5 : 4}
                        className="px-5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-700"
                      >
                        {team.name} · {team.projects.length} dự án
                      </th>
                    </tr>
                    {team.projects.map((project) => {
                      const status = projectStatusInfo(project.status);
                      const done = project.tasks.length;
                      const total = project._count.tasks;
                      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
                      return (
                        <tr key={project.id} className="border-b border-zinc-100 last:border-b-0">
                          <td className="px-5 py-3">
                            <Link
                              href={`/projects/${project.id}`}
                              prefetch={false}
                              className="flex items-center gap-2.5 font-semibold text-zinc-900 hover:text-brand-700"
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: status.color }}
                                aria-hidden="true"
                              />
                              {project.name}
                            </Link>
                            <span className="ml-[18px] text-xs text-zinc-600">
                              {projectCategoryInfo(project.category).label}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`tf-badge ${status.className}`}>{status.label}</span>
                          </td>
                          <td className="px-3 py-3">
                            <span className="flex items-center gap-2">
                              <span
                                className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200"
                                role="img"
                                aria-label={`${done}/${total} task hoàn thành`}
                              >
                                <span
                                  className="block h-full rounded-full"
                                  style={{ width: `${percent}%`, backgroundColor: status.color }}
                                />
                              </span>
                              <span className="w-10 text-right text-xs tabular-nums text-zinc-600">
                                {done}/{total}
                              </span>
                            </span>
                          </td>
                          {showRevenue && (
                            <td className="px-3 py-3 text-right tabular-nums">
                              {project.category === "CLIENT" && project.revenue > 0 ? (
                                formatVND(project.revenue)
                              ) : (
                                <span className="text-zinc-500">—</span>
                              )}
                            </td>
                          )}
                          <td className="px-5 py-3 text-right tabular-nums">{project._count.members}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
