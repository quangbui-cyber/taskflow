import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import CreateUserForm from "@/components/CreateUserForm";
import UserAccountManager from "@/components/UserAccountManager";
import MemberGroupManager from "@/components/MemberGroupManager";
import CatalogManager from "@/components/CatalogManager";
import AccountCatalogManager from "@/components/AccountCatalogManager";
import ClientCatalogManager from "@/components/ClientCatalogManager";
import {
  createSalesTeam,
  deleteSalesTeam,
} from "@/app/actions/catalog";

const SETTINGS_TABS = [
  { key: "create-user", label: "Tạo tài khoản" },
  { key: "users", label: "Quản lý tài khoản" },
  { key: "groups", label: "Tạo nhóm" },
  { key: "client", label: "Client" },
  { key: "team", label: "Team" },
  { key: "account", label: "Account" },
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

  if (activeTab === "team") {
    const salesTeams = await prisma.salesTeam.findMany({
      include: { _count: { select: { accounts: true } } },
      orderBy: { name: "asc" },
    });

    return (
      <CatalogManager
        title="Team"
        hint="Tạo Team trước khi phân Account vào nhóm kinh doanh."
        placeholder="Tên team, ví dụ: Team Sales 1"
        items={salesTeams.map((team) => ({
          id: team.id,
          name: team.name,
          projectCount: team._count.accounts,
        }))}
        createAction={createSalesTeam}
        deleteAction={deleteSalesTeam}
        countLabel="account"
      />
    );
  }

  const [accounts, salesTeams, accountUsers] = await Promise.all([
    prisma.account.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        _count: { select: { projects: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.salesTeam.findMany({ orderBy: { name: "asc" } }),
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

  return (
    <AccountCatalogManager
      accounts={accounts.map((account) => ({
        id: account.id,
        name: account.user?.name ?? account.name,
        email: account.user?.email ?? null,
        avatarUrl: account.user?.avatarUrl ?? null,
        projectCount: account._count.projects,
        teamId: account.teamId,
        linked: Boolean(account.userId),
      }))}
      accountUsers={accountUsers}
      teams={salesTeams.map((team) => ({ id: team.id, name: team.name }))}
    />
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [admin, params] = await Promise.all([requireAdmin(), searchParams]);
  const activeTab: SettingsTab = isSettingsTab(params.tab)
    ? params.tab
    : "create-user";
  const sidebarProjects = await prisma.project.findMany({
    where: { members: { some: { userId: admin.id } } },
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
                Quản lý tài khoản, nhóm nhân sự và danh mục kinh doanh.
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
            {SETTINGS_TABS.map((tab) => (
              <Link
                key={tab.key}
                href={`/admin?tab=${tab.key}`}
                prefetch={false}
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
