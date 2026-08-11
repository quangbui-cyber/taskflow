import Link from "next/link";
import {
  Archive,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  LogOut,
  Plus,
  Settings,
  Star,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/app/actions/auth";
import Brand from "@/components/Brand";
import Avatar from "@/components/Avatar";
import MobileSidebarMenu from "@/components/MobileSidebarMenu";
import { canManageProjects } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isArchivedProjectStatus, projectStatusColor } from "@/lib/types";

type ProjectItem = {
  id: string;
  name: string;
  color: string;
  status: string;
  account: { team: { id: string; name: string } } | null;
};
type ActiveSection =
  | "home"
  | "notifications"
  | "recognition"
  | "team"
  | "revenue"
  | "admin";

const ARCHIVED_PROJECT_GROUPS = [
  { status: "DONE", label: "Done", dotClassName: "bg-emerald-500" },
  { status: "FAIL", label: "Fail", dotClassName: "bg-red-500" },
  { status: "CANCEL", label: "Cancel", dotClassName: "bg-zinc-400" },
  { status: "PENDING", label: "Pending", dotClassName: "bg-violet-500" },
] as const;

const PROJECT_STATUS_ORDER: Record<string, number> = {
  ON_PROCESS: 0,
  BIDDING: 1,
};

function compareProjects(a: ProjectItem, b: ProjectItem) {
  const statusOrder =
    (PROJECT_STATUS_ORDER[a.status] ?? Number.MAX_SAFE_INTEGER) -
    (PROJECT_STATUS_ORDER[b.status] ?? Number.MAX_SAFE_INTEGER);

  if (statusOrder !== 0) return statusOrder;

  return a.name.localeCompare(b.name, "vi", { sensitivity: "base" });
}

function MenuLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      // Mỗi trang này đều tự truy vấn Prisma riêng (task, doanh số, hiệu suất...).
      // Tắt prefetch để tránh render ngầm hàng loạt trang mỗi khi sidebar hiện ra,
      // vốn nhân số lượng query lên nhiều lần không cần thiết và làm chậm app.
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-10 items-center gap-3 rounded-[7px] px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-brand-50 font-medium text-brand-700"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
      }`}
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="min-w-5 rounded-full bg-red-500 px-1.5 text-center text-[10px] font-bold leading-5 text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

function ProjectLinks({
  projects,
  activeProjectId,
}: {
  projects: ProjectItem[];
  activeProjectId?: string;
}) {
  if (projects.length === 0) {
    return <p className="px-3 py-2 text-sm text-zinc-400">Chưa có dự án</p>;
  }

  return (
    <ul className="space-y-1">
      {[...projects].sort(compareProjects).map((project) => (
        <li key={project.id}>
          <Link
            href={`/projects/${project.id}`}
            prefetch={false}
            className={`flex min-h-10 items-center gap-3 rounded-[7px] px-3 py-2 text-sm transition-colors ${
              project.id === activeProjectId
                ? "bg-brand-50 font-medium text-brand-700"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: projectStatusColor(project.status) }}
              aria-hidden="true"
            />
            <span className="truncate">{project.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ActiveProjectLinks({
  projects,
  activeProjectId,
}: {
  projects: ProjectItem[];
  activeProjectId?: string;
}) {
  if (projects.length === 0) {
    return <p className="px-3 py-2 text-sm text-zinc-400">Chưa có dự án</p>;
  }

  const teams = projects.reduce<
    Array<{ id: string; name: string; projects: ProjectItem[] }>
  >((groups, project) => {
    const team = project.account?.team;
    const teamId = team?.id ?? "unassigned";
    const existingGroup = groups.find((group) => group.id === teamId);

    if (existingGroup) {
      return groups.map((group) =>
        group.id === teamId
          ? { ...group, projects: [...group.projects, project] }
          : group
      );
    }

    return [
      ...groups,
      {
        id: teamId,
        name: team?.name ?? "Chưa gán Team",
        projects: [project],
      },
    ];
  }, []);

  teams.sort((a, b) => {
    if (a.id === "unassigned") return 1;
    if (b.id === "unassigned") return -1;
    return a.name.localeCompare(b.name, "vi");
  });

  return (
    <div className="space-y-1">
      {teams.map((team) => (
        <details
          key={team.id}
          open
          className="group/active-team"
          data-team-id={team.id}
        >
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-[6px] px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800">
            <UsersRound size={14} strokeWidth={1.8} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{team.name}</span>
            <span className="text-[10px] tabular-nums text-zinc-400">
              {team.projects.length}
            </span>
            <ChevronDown
              size={13}
              className="text-zinc-400 transition-transform group-open/active-team:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="ml-3 border-l border-zinc-200 pl-1">
            <ProjectLinks
              projects={team.projects}
              activeProjectId={activeProjectId}
            />
          </div>
        </details>
      ))}
    </div>
  );
}

function ArchivedProjectLinks({
  projects,
  activeProjectId,
}: {
  projects: ProjectItem[];
  activeProjectId?: string;
}) {
  if (projects.length === 0) return null;

  return (
    <details
      className="group mt-3"
      open={projects.some((project) => project.id === activeProjectId)}
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-[7px] px-3 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800">
        <Archive size={15} strokeWidth={1.8} aria-hidden="true" />
        <span className="flex-1">Lưu trữ</span>
        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {projects.length}
        </span>
        <ChevronDown
          size={14}
          className="transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1 space-y-1 border-l border-zinc-200 pl-2">
        {ARCHIVED_PROJECT_GROUPS.map((group) => {
          const groupProjects = projects.filter(
            (project) => project.status === group.status
          );
          if (groupProjects.length === 0) return null;
          const containsActiveProject = groupProjects.some(
            (project) => project.id === activeProjectId
          );

          return (
            <details
              key={group.status}
              className="group/archive-status"
              open={containsActiveProject}
            >
              <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-[6px] px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${group.dotClassName}`}
                  aria-hidden="true"
                />
                <span className="flex-1 font-medium">{group.label}</span>
                <span className="text-[10px] tabular-nums text-zinc-400">
                  {groupProjects.length}
                </span>
                <ChevronDown
                  size={13}
                  className="text-zinc-400 transition-transform group-open/archive-status:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="ml-2 mt-1 border-l border-zinc-200 pl-2">
                <ProjectLinks
                  projects={groupProjects}
                  activeProjectId={activeProjectId}
                />
              </div>
            </details>
          );
        })}
      </div>
    </details>
  );
}

export default async function Sidebar({
  user,
  projects,
  activeProjectId,
  activeSection = "home",
}: {
  user: {
    id: string;
    name: string;
    email: string;
    role?: string;
    avatarUrl?: string | null;
  };
  projects: ProjectItem[];
  activeProjectId?: string;
  activeSection?: ActiveSection;
}) {
  const unreadCount = await prisma.notification.count({
    where: { userId: user.id, read: false },
  });
  const canManage = canManageProjects(user.role ?? "");
  const activeProjects = projects.filter(
    (project) => !isArchivedProjectStatus(project.status)
  );
  const archivedProjects = projects.filter((project) =>
    isArchivedProjectStatus(project.status)
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-zinc-200 bg-white md:flex">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[72px] shrink-0 items-center border-b border-zinc-200 px-5">
            <Link href="/" aria-label="myCreative - Trang công việc">
              <Brand />
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            <nav className="space-y-1" aria-label="Không gian làm việc">
              <MenuLink href="/" label="Công việc" icon={CheckCircle2} active={activeSection === "home" && !activeProjectId} />
              <MenuLink href="/notifications" label="Thông báo" icon={Bell} active={activeSection === "notifications"} badge={unreadCount} />
              <MenuLink href="/recognition" label="Góc cảm ơn" icon={Star} active={activeSection === "recognition"} />
              <MenuLink href="/team" label="Hiệu suất" icon={UsersRound} active={activeSection === "team"} />
              {canManage && (
                <MenuLink href="/revenue" label="Doanh số" icon={CircleDollarSign} active={activeSection === "revenue"} />
              )}
            </nav>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between px-3">
                <span className="text-xs font-semibold uppercase text-zinc-400">Dự án</span>
                {canManage && (
                  <Link
                    href="/projects/new"
                    prefetch={false}
                    className="flex h-7 w-7 items-center justify-center rounded-[6px] text-zinc-400 hover:bg-zinc-100 hover:text-brand-700"
                    title="Tạo dự án"
                    aria-label="Tạo dự án"
                  >
                    <Plus size={17} aria-hidden="true" />
                  </Link>
                )}
              </div>
              <ActiveProjectLinks
                projects={activeProjects}
                activeProjectId={activeProjectId}
              />
              <ArchivedProjectLinks
                projects={archivedProjects}
                activeProjectId={activeProjectId}
              />
            </div>

            {user.role === "ADMIN" && (
              <div className="mt-6 border-t border-zinc-200 pt-4">
                <p className="mb-2 px-3 text-xs font-semibold uppercase text-zinc-400">Quản trị</p>
                <MenuLink href="/admin" label="Cài đặt" icon={Settings} active={activeSection === "admin"} />
              </div>
            )}
          </div>

          <div className="border-t border-zinc-200 p-3">
            <div className="flex items-center gap-3 rounded-[7px] px-2 py-2">
              <Avatar
                id={user.id}
                name={user.name}
                avatarUrl={user.avatarUrl}
                className="h-9 w-9 text-sm"
              />
              <div className="min-w-0 flex-1" title={user.email}>
                <p className="truncate text-sm font-medium text-zinc-800">{user.name}</p>
                <p className="truncate text-xs text-zinc-400">{user.email}</p>
              </div>
              <form action={logout}>
                <button
                  type="submit"
                  className="flex h-9 w-9 items-center justify-center rounded-[7px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  title="Đăng xuất"
                  aria-label="Đăng xuất"
                >
                  <LogOut size={17} aria-hidden="true" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/95 px-4 backdrop-blur md:hidden">
        <Link href="/" aria-label="myCreative - Trang công việc">
          <Brand compact />
        </Link>
        <MobileSidebarMenu>
          <div className="absolute right-0 top-12 z-50 max-h-[calc(100vh-80px)] w-[min(88vw,340px)] overflow-y-auto rounded-[8px] border border-zinc-200 bg-white p-3 shadow-xl">
            <div className="space-y-1">
              <MenuLink href="/" label="Công việc" icon={CheckCircle2} active={activeSection === "home" && !activeProjectId} />
              <MenuLink href="/notifications" label="Thông báo" icon={Bell} active={activeSection === "notifications"} badge={unreadCount} />
              <MenuLink href="/recognition" label="Góc cảm ơn" icon={Star} active={activeSection === "recognition"} />
              <MenuLink href="/team" label="Hiệu suất" icon={UsersRound} active={activeSection === "team"} />
              {canManage && <MenuLink href="/revenue" label="Doanh số" icon={CircleDollarSign} active={activeSection === "revenue"} />}
            </div>
            <div className="my-3 border-t border-zinc-200" />
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="text-xs font-semibold uppercase text-zinc-400">Dự án</span>
              {canManage && (
                <Link href="/projects/new" prefetch={false} className="tf-icon-button !h-8 !min-h-8 !w-8" aria-label="Tạo dự án" title="Tạo dự án">
                  <Plus size={16} aria-hidden="true" />
                </Link>
              )}
            </div>
            <ActiveProjectLinks
              projects={activeProjects}
              activeProjectId={activeProjectId}
            />
            <ArchivedProjectLinks
              projects={archivedProjects}
              activeProjectId={activeProjectId}
            />
            {user.role === "ADMIN" && (
              <div className="mt-3 border-t border-zinc-200 pt-3">
                <MenuLink href="/admin" label="Cài đặt" icon={Settings} active={activeSection === "admin"} />
              </div>
            )}
            <div className="mt-3 flex items-center gap-3 border-t border-zinc-200 px-2 pt-3">
              <Avatar
                id={user.id}
                name={user.name}
                avatarUrl={user.avatarUrl}
                className="h-9 w-9 text-sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-zinc-400">{user.email}</p>
              </div>
              <form action={logout}>
                <button type="submit" className="tf-icon-button !h-9 !min-h-9 !w-9" aria-label="Đăng xuất" title="Đăng xuất">
                  <LogOut size={16} aria-hidden="true" />
                </button>
              </form>
            </div>
          </div>
        </MobileSidebarMenu>
      </header>
    </>
  );
}
