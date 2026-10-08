import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { meetingsEnabled } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import CreateUserForm from "@/components/CreateUserForm";
import UserAccountManager from "@/components/UserAccountManager";
import MemberGroupManager from "@/components/MemberGroupManager";
import SalesTeamManager from "@/components/SalesTeamManager";
import AccountCatalogManager from "@/components/AccountCatalogManager";
import ClientCatalogManager from "@/components/ClientCatalogManager";
import QuotationTemplateAdmin from "@/components/QuotationTemplateAdmin";
import MeetingRoomManager from "@/components/MeetingRoomManager";

const SETTINGS_TABS = [
  { key: "create-user", label: "Tạo tài khoản" },
  { key: "users", label: "Quản lý tài khoản" },
  { key: "groups", label: "Phòng ban / Nhóm" },
  { key: "client", label: "Client" },
  { key: "account", label: "Team & Account" },
  { key: "quotation-templates", label: "Mẫu báo giá" },
  { key: "rooms", label: "Phòng họp" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

function isSettingsTab(value: string | undefined): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.key === value);
}

async function SettingsContent({
  activeTab,
  adminId,
}: {
  activeTab: SettingsTab;
  adminId: string;
}) {
  if (activeTab === "create-user") return <CreateUserForm />;

  if (activeTab === "users") {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        deactivatedAt: true,
        avatarUrl: true,
        managerId: true,
        createdAt: true,
        accountProfile: { select: { id: true } },
        _count: {
          select: {
            ownedProjects: true,
            createdTasks: true,
            assignedTasks: true,
            memberships: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    const managers = users.filter((manager) => manager.isActive).map((manager) => ({
      id: manager.id,
      name: manager.name,
      email: manager.email,
      avatarUrl: manager.avatarUrl,
    }));

    return (
      <UserAccountManager
        adminId={adminId}
        managers={managers}
        users={users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          deactivatedAt: user.deactivatedAt?.toISOString() ?? null,
          avatarUrl: user.avatarUrl,
          managerId: user.managerId,
          createdAt: user.createdAt.toISOString(),
          assignedTaskCount: user._count.assignedTasks,
          createdTaskCount: user._count.createdTasks,
          projectMemberCount: user._count.memberships,
          ownedProjectCount: user._count.ownedProjects,
          isAccount: Boolean(user.accountProfile),
        }))}
      />
    );
  }

  if (activeTab === "groups") {
    const [users, memberGroups] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true, avatarUrl: true },
        orderBy: { name: "asc" },
      }),
      prisma.memberGroup.findMany({
        include: { members: { select: { userId: true } } },
        orderBy: { name: "asc" },
      }),
    ]);

    return (
      <MemberGroupManager
        users={users}
        groups={memberGroups.map((group) => ({
          id: group.id,
          name: group.name,
          memberIds: group.members.map((member) => member.userId),
        }))}
      />
    );
  }

  if (activeTab === "client") {
    const clients = await prisma.client.findMany({
      include: { _count: { select: { projects: true } } },
      orderBy: { name: "asc" },
    });

    return (
      <ClientCatalogManager
        clients={clients.map((client) => ({
          id: client.id,
          name: client.name,
          projectCount: client._count.projects,
        }))}
      />
    );
  }

  if (activeTab === "rooms") {
    const rooms = await prisma.meetingRoom.findMany({
      include: {
        _count: {
          select: {
            meetings: {
              where: { status: "SCHEDULED", endAt: { gte: new Date() } },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return (
      <MeetingRoomManager
        rooms={rooms.map((room) => ({
          id: room.id,
          name: room.name,
          capacity: room.capacity,
          isActive: room.isActive,
          upcomingCount: room._count.meetings,
        }))}
      />
    );
  }

  if (activeTab === "quotation-templates") {
    const [proposals, templates] = await Promise.all([
      prisma.quotationTemplateProposal.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.quotationTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
    const userIds = [...new Set([...proposals.map(item => item.proposedBy), ...templates.map(item => item.createdBy)])];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const names = new Map(users.map(user => [user.id, user.name]));
    return <QuotationTemplateAdmin
      proposals={proposals.map(item => ({ id: item.id, proposedName: item.proposedName, note: item.note, status: item.status, proposedByName: names.get(item.proposedBy) ?? "Tài khoản không còn hoạt động", createdAt: item.createdAt.toISOString(), rejectionReason: item.rejectionReason }))}
      templates={templates.map(item => ({ id: item.id, name: item.name, description: item.description, status: item.status, createdByName: names.get(item.createdBy) ?? "Tài khoản không còn hoạt động", createdAt: item.createdAt.toISOString(), archivedAt: item.archivedAt?.toISOString() ?? null }))}
    />;
  }

  const [accounts, salesTeams, accountUsers] = await Promise.all([
    prisma.account.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        _count: { select: { projects: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.salesTeam.findMany({
      select: {
        id: true,
        name: true,
        leaderId: true,
        accounts: {
          select: { id: true, name: true, user: { select: { name: true } } },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        role: { in: ["ADMIN", "ACCOUNT"] },
        accountProfile: null,
        isActive: true,
      },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Xếp theo ABC kiểu tiếng Việt; Account gom theo team rồi mới theo tên.
  const compareVi = (a: string, b: string) =>
    a.localeCompare(b, "vi", { sensitivity: "base", numeric: true });
  const sortedTeams = [...salesTeams].sort((a, b) => compareVi(a.name, b.name));
  const teamOrder = new Map(sortedTeams.map((team, index) => [team.id, index]));
  const sortedAccounts = [...accounts].sort(
    (a, b) =>
      (teamOrder.get(a.teamId) ?? 0) - (teamOrder.get(b.teamId) ?? 0) ||
      compareVi(a.user?.name ?? a.name, b.user?.name ?? b.name)
  );

  return (
    <div className="space-y-6">
      <SalesTeamManager
        teams={sortedTeams.map((team) => ({
          id: team.id,
          name: team.name,
          leaderId: team.leaderId,
          accounts: team.accounts
            .map((account) => ({
              id: account.id,
              name: account.user?.name ?? account.name,
            }))
            .sort((a, b) => compareVi(a.name, b.name)),
        }))}
      />
      <AccountCatalogManager
        accounts={sortedAccounts.map((account) => ({
          id: account.id,
          name: account.user?.name ?? account.name,
          email: account.user?.email ?? null,
          avatarUrl: account.user?.avatarUrl ?? null,
          projectCount: account._count.projects,
          teamId: account.teamId,
          linked: Boolean(account.userId),
        }))}
        accountUsers={accountUsers}
        teams={sortedTeams.map((team) => ({ id: team.id, name: team.name }))}
      />
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [admin, params] = await Promise.all([requireAdmin(), searchParams]);
  const requestedTab = params.tab === "team" ? "account" : params.tab;
  const activeTab: SettingsTab =
    isSettingsTab(requestedTab) &&
    (requestedTab !== "rooms" || meetingsEnabled())
    ? requestedTab
    : "create-user";
  const sidebarProjects = await prisma.project.findMany({
    where: { members: { some: { userId: admin.id } } },
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
  });

  return (
    <div className="tf-shell">
      <Sidebar user={admin} projects={sidebarProjects} activeSection="admin" />

      <main className="tf-main">
        <div className="tf-page space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="tf-page-title">Cài đặt</h1>
              <p className="tf-page-subtitle">
                Quản lý tài khoản, nhóm nhân sự, danh mục kinh doanh và phòng họp.
              </p>
            </div>
            <Link href="/team" prefetch={false} className="tf-button-secondary">
              <BarChart3 size={16} aria-hidden="true" />
              Hiệu suất
            </Link>
          </div>

          <nav
            className="tf-scroll-tabs flex gap-1 border-b border-zinc-200"
            aria-label="Các mục cài đặt"
          >
            {SETTINGS_TABS.filter(
              (tab) => tab.key !== "rooms" || meetingsEnabled()
            ).map((tab) => (
              <Link
                key={tab.key}
                href={`/admin?tab=${tab.key}`}
                prefetch={false}
                aria-current={activeTab === tab.key ? "page" : undefined}
                className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "border-brand-500 text-zinc-950"
                    : "border-transparent text-zinc-500 hover:text-zinc-900"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </nav>

          <SettingsContent activeTab={activeTab} adminId={admin.id} />
        </div>
      </main>
    </div>
  );
}
