import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { meetingsEnabled, crmEnabled } from "@/lib/features";
import { crmLimitedAccessActive } from "@/lib/crm/access";
import { OPEN_PROJECT_STATUSES, OPEN_TASK_STATUS_FILTER } from "@/lib/types";
import { getCrmSettings, listReasons, listProgramTypesForAdmin, listSettingChanges, listClientTags, listCompetitors } from "@/lib/crm/settings";
import { evaluatePrepilot, loadPrepilotInput, prepilotSectionFlags } from "@/lib/crm/prepilot";
import CrmSettings from "@/components/crm/CrmSettings";
import CrmAccessSettings from "@/components/crm/CrmAccessSettings";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import CreateUserForm from "@/components/CreateUserForm";
import UserAccountManager from "@/components/UserAccountManager";
import MemberGroupManager from "@/components/MemberGroupManager";
import SalesTeamManager from "@/components/SalesTeamManager";
import AccountCatalogManager from "@/components/AccountCatalogManager";
import ClientCatalogManager from "@/components/ClientCatalogManager";
import ClientMergeManager from "@/components/crm/ClientMergeManager";
import { listDuplicateClientPairs } from "@/lib/crm/clientMerge";
import MeetingRoomManager from "@/components/MeetingRoomManager";
import RecapGlossaryManager from "@/components/RecapGlossaryManager";
import DriveStorageSettings from "@/components/DriveStorageSettings";
import { googleAuthConfigured } from "@/lib/googleAuth";
import { pendingDriveFileCounts } from "@/lib/driveStorage";

const SETTINGS_TABS = [
  { key: "create-user", label: "Tạo tài khoản" },
  { key: "users", label: "Quản lý tài khoản" },
  { key: "groups", label: "Phòng ban / Nhóm" },
  { key: "client", label: "Client" },
  { key: "crm", label: "CRM" },
  { key: "account", label: "Team & Account" },
  { key: "rooms", label: "Phòng họp" },
  { key: "glossary", label: "Từ điển họp" },
  { key: "storage", label: "Lưu trữ" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

// Không hiện trên thanh tab; vẫn mở được bằng đường dẫn nên kết nối Google Drive (và các
// đường dẫn quay về sau khi cấp quyền) vẫn hoạt động.
const HIDDEN_TABS: readonly SettingsTab[] = ["glossary", "storage"];

function isSettingsTab(value: string | undefined): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.key === value);
}

async function SettingsContent({
  activeTab,
  adminId,
  driveResult,
}: {
  activeTab: SettingsTab;
  adminId: string;
  driveResult?: string;
}) {
  if (activeTab === "create-user") return <CreateUserForm />;
  if (activeTab === "crm" && crmEnabled()) {
    const [settings, reasons, programTypes, teams, users, history, prepilotInput, clientTags, competitors] = await Promise.all([
      getCrmSettings(prisma), listReasons(prisma, { includeHidden: true }), listProgramTypesForAdmin(prisma),
      prisma.salesTeam.findMany({ include: { crmManagedTeam: { select: { userId: true } } }, orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true, email: true, avatarUrl: true, isCrmDataSteward: true, role: true }, orderBy: { name: "asc" } }),
      Promise.all(["tier.", "reminder.", "reason.", "programType.", "review.", "teamManagers.", "stewards", "pipeline.mode", "persona.depth", "client.industries", "client.sources", "clientTag.", "competitor.", "access.users"].map((key) => listSettingChanges(prisma, key, 20))),
      loadPrepilotInput(prisma, new Date()),
      listClientTags(prisma, { includeHidden: true }), listCompetitors(prisma, { includeHidden: true }),
    ]);
    const notConfigured = prepilotSectionFlags(evaluatePrepilot(prepilotInput));
    const changes = history.flat()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }));
    return <div className="space-y-6">
      {/* crm51: Admin → CRM → Dữ liệu (tracker import and duplicate merge, moved out of the CRM tab bar). */}
      <nav aria-label="Mục CRM" className="flex flex-wrap gap-2"><span aria-current="page" className="inline-flex min-h-9 items-center rounded-full bg-zinc-900 px-3.5 text-sm font-medium text-white">Cấu hình</span><Link href="/admin/crm-data" prefetch={false} className="inline-flex min-h-9 items-center rounded-full border border-zinc-200 bg-white px-3.5 text-sm text-zinc-600 hover:text-zinc-900">Dữ liệu</Link></nav>
      <CrmSettings initial={settings} reasons={reasons} programTypes={programTypes} changes={changes} notConfigured={notConfigured} clientTags={clientTags.map((t) => ({ id: t.id, label: t.label, active: t.active, order: t.order }))} competitors={competitors.map((c) => ({ id: c.id, name: c.name, active: c.active }))} />
      <CrmAccessSettings teams={teams.map((t) => ({ id: t.id, name: t.name, managerIds: t.crmManagedTeam.map((m) => m.userId) }))} users={users} stewardIds={users.filter((u) => u.isCrmDataSteward).map((u) => u.id)} pipelineMode={settings.pipelineMode} version={settings.versions["pipeline.mode"]} changes={changes} notConfigured={notConfigured} access={{ userIds: settings.accessUserIds, version: settings.versions["access.users"], adminIds: users.filter((u) => u.role === "ADMIN").map((u) => u.id), limited: crmLimitedAccessActive() }} />
    </div>;
  }

  if (activeTab === "storage") {
    const [connection, counts] = await Promise.all([
      prisma.googleDriveConnection.findUnique({
        where: { id: "default" },
        select: { email: true, connectedAt: true, lastError: true, lastErrorAt: true },
      }),
      pendingDriveFileCounts(),
    ]);
    return (
      <DriveStorageSettings
        configured={googleAuthConfigured()}
        connection={
          connection
            ? {
                email: connection.email,
                connectedAt: connection.connectedAt.toISOString(),
                lastError: connection.lastError,
                lastErrorAt: connection.lastErrorAt?.toISOString() ?? null,
              }
            : null
        }
        counts={counts}
        result={driveResult}
      />
    );
  }

  if (activeTab === "users") {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
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
            ownedProjects: { where: { status: { in: OPEN_PROJECT_STATUSES } } },
            assignedTasks: {
              where: {
                status: OPEN_TASK_STATUS_FILTER,
                project: { status: { in: OPEN_PROJECT_STATUSES } },
              },
            },
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
          openOwnedProjectCount: user._count.ownedProjects,
          openAssignedTaskCount: user._count.assignedTasks,
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
    if (crmEnabled()) return <ClientMergeManager pairs={await listDuplicateClientPairs(prisma)} />;
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

  if (activeTab === "glossary") {
    const entries = await prisma.recapGlossaryTerm.findMany({
      orderBy: [{ kind: "asc" }, { useCount: "desc" }, { updatedAt: "desc" }],
      select: { id: true, kind: true, text: true, heardAs: true, useCount: true },
    });
    return <RecapGlossaryManager entries={entries} />;
  }

  const [accounts, salesTeams, accountUsers] = await Promise.all([
    prisma.account.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true, isActive: true },
        },
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
          archived: account.user ? !account.user.isActive : false,
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
  searchParams: Promise<{ tab?: string; drive?: string }>;
}) {
  const [admin, params] = await Promise.all([requireAdmin(), searchParams]);
  const requestedTab = params.tab === "team" ? "account" : params.tab;
  const activeTab: SettingsTab =
    isSettingsTab(requestedTab) &&
    ((requestedTab !== "rooms" && requestedTab !== "glossary") || meetingsEnabled()) &&
    (requestedTab !== "crm" || crmEnabled())
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
              (tab) =>
                !HIDDEN_TABS.includes(tab.key) &&
                (tab.key !== "crm" || crmEnabled()) &&
                ((tab.key !== "rooms" && tab.key !== "glossary") || meetingsEnabled())
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

          <SettingsContent activeTab={activeTab} adminId={admin.id} driveResult={params.drive} />
        </div>
      </main>
    </div>
  );
}
