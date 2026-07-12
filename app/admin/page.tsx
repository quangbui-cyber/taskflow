import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import CreateUserForm from "@/components/CreateUserForm";
import UserRow from "@/components/UserRow";
import MemberGroupManager from "@/components/MemberGroupManager";
import CatalogManager from "@/components/CatalogManager";
import AccountCatalogManager from "@/components/AccountCatalogManager";
import {
  createClient,
  createSalesTeam,
  deleteClient,
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

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const admin = await requireAdmin();
  const requestedTab = (await searchParams).tab;
  const activeTab: SettingsTab = isSettingsTab(requestedTab)
    ? requestedTab
    : "create-user";

  const [
    users,
    memberGroups,
    clients,
    accounts,
    salesTeams,
    accountUsers,
    sidebarProjects,
  ] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        managerId: true,
        createdAt: true,
        _count: {
          select: {
            assignedTasks: true,
            memberships: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.memberGroup.findMany({
      include: { members: { select: { userId: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.client.findMany({
      include: { _count: { select: { projects: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.account.findMany({
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { projects: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.salesTeam.findMany({
      include: { _count: { select: { accounts: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: "ACCOUNT", accountProfile: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { members: { some: { userId: admin.id } } },
      select: { id: true, name: true, color: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const userOptions = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
  }));

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
            <Link href="/team" className="tf-button-secondary">
              <BarChart3 size={16} aria-hidden="true" />
              Hiệu suất
            </Link>
          </div>

          <nav
            className="flex gap-1 overflow-x-auto border-b border-zinc-200"
            aria-label="Các mục cài đặt"
          >
            {SETTINGS_TABS.map((tab) => (
              <Link
                key={tab.key}
                href={`/admin?tab=${tab.key}`}
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

          {activeTab === "create-user" && <CreateUserForm />}

          {activeTab === "users" && (
            <section className="tf-panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
                <h2 className="font-semibold">Tài khoản ({users.length})</h2>
              </div>
              <ul className="divide-y divide-zinc-100">
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={{
                      id: user.id,
                      name: user.name,
                      email: user.email,
                      role: user.role,
                      managerId: user.managerId,
                      createdAt: user.createdAt.toISOString(),
                      taskCount: user._count.assignedTasks,
                      projectCount: user._count.memberships,
                    }}
                    isSelf={user.id === admin.id}
                    managers={users.map((manager) => ({
                      id: manager.id,
                      name: manager.name,
                    }))}
                  />
                ))}
              </ul>
            </section>
          )}

          {activeTab === "groups" && (
            <MemberGroupManager
              users={userOptions}
              groups={memberGroups.map((group) => ({
                id: group.id,
                name: group.name,
                memberIds: group.members.map((member) => member.userId),
              }))}
            />
          )}

          {activeTab === "client" && (
            <CatalogManager
              title="Client"
              hint="Nhóm khách hàng để phân loại và theo dõi doanh số."
              placeholder="Tên client, ví dụ: Ngân hàng ABC"
              items={clients.map((client) => ({
                id: client.id,
                name: client.name,
                projectCount: client._count.projects,
              }))}
              createAction={createClient}
              deleteAction={deleteClient}
            />
          )}

          {activeTab === "team" && (
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
          )}

          {activeTab === "account" && (
            <AccountCatalogManager
              accounts={accounts.map((account) => ({
                id: account.id,
                name: account.user?.name ?? account.name,
                email: account.user?.email ?? null,
                projectCount: account._count.projects,
                teamId: account.teamId,
                linked: Boolean(account.userId),
              }))}
              accountUsers={accountUsers}
              teams={salesTeams.map((team) => ({ id: team.id, name: team.name }))}
            />
          )}
        </div>
      </main>
    </div>
  );
}
