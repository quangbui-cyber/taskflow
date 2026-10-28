import Link from "next/link";
import { parseCommentMentions } from "@/lib/commentMentions";
import {
  ArrowLeft,
  Banknote,
  FileText,
  Kanban,
  MessagesSquare,
  Pencil,
} from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canViewRevenue as hasRevenueAccess, requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import Board from "@/components/Board";
import ProjectMembersPanel from "@/components/ProjectMembersPanel";
import ProjectEditButton from "@/components/ProjectEditButton";
import ProjectActionsMenu from "@/components/ProjectActionsMenu";
import { chatAppConfigured, chatAppProblem } from "@/lib/googleChatApp";
import ProjectChatSpacePanel from "@/components/ProjectChatSpacePanel";
import { canAddChatApp, canManageChatSpaces, googleWorkspaceConfigured } from "@/lib/googleWorkspace";
import ProjectFilesPanel from "@/components/ProjectFilesPanel";
import ProjectFinancePanel from "@/components/ProjectFinancePanel";
import ProjectStatusSelect from "@/components/ProjectStatusSelect";
import MeetingComposer from "@/components/MeetingComposer";
import { financeEnabled, meetingsEnabled } from "@/lib/features";
import { loadMeetingComposerData } from "@/lib/meetingComposerData";
import { ProjectBoardProvider } from "@/components/ProjectBoardContext";
import ProjectBoardToolbar from "@/components/ProjectBoardToolbar";
import {
  formatVND,
  projectStatusColor,
  type MemberDTO,
  type TaskDTO,
} from "@/lib/types";
import { toDateInputVN } from "@/lib/dates";
import { FINANCE_APPROVER_ROLES, canSetFinanceApprovers } from "@/lib/financePolicy";
import { ROLE_LABELS, isUserRole } from "@/lib/roles";
import { storedFileDriveUrl } from "@/lib/storedFileResponse";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; task?: string; google?: string }>;
}) {
  const { id } = await params;
  const { tab, task: requestedTaskId, google: googleResult } = await searchParams;
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      googleChatSpaceBy: { select: { name: true } },
      responsibleTeam: { select: { id: true, name: true } },
      responsibleGroup: { select: { id: true, name: true } },
      account: {
        select: {
          id: true,
          name: true,
          user: { select: { name: true, email: true, avatarUrl: true } },
          team: { select: { id: true, name: true } },
        },
      },
      icApprover: { select: { name: true } },
      acApprover: { select: { name: true } },
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true, isActive: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      tasks: {
        include: {
          creator: { select: { id: true, name: true, avatarUrl: true } },
          comments: {
            include: {
              author: { select: { id: true, name: true, avatarUrl: true } },
            },
            orderBy: { createdAt: "asc" },
          },
          followers: {
            include: {
              user: { select: { id: true, name: true, avatarUrl: true } },
            },
          },
          // Chỉ lấy thông tin mô tả; nội dung tệp tải riêng qua API khi bấm tải về.
          files: {
            select: {
              id: true,
              kind: true,
              name: true,
              mimeType: true,
              size: true,
              createdAt: true,
              driveFileId: true,
              uploader: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
      files: {
        select: {
          id: true,
          name: true,
          mimeType: true,
          size: true,
          createdAt: true,
          driveFileId: true,
          uploader: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!project) notFound();
  const isMember = project.members.some((m) => m.userId === user.id);
  if (!isMember && user.role !== "ADMIN") redirect("/");

  const showMeetings = meetingsEnabled();
  const showFinance = financeEnabled();
  const canEditApprovers =
    showFinance &&
    (project.ownerId === user.id || user.role === "ADMIN") &&
    canSetFinanceApprovers(user.role);
  const [sidebarProjects, clients, accounts, availableUsers, memberGroups, teams, meetingData, approverUsers] = await Promise.all([
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
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
    }),
    prisma.client.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.account.findMany({
      where: { user: { isActive: true, role: { in: ["ADMIN", "ACCOUNT"] } } },
      select: {
        id: true,
        name: true,
        userId: true,
        user: { select: { name: true, email: true, avatarUrl: true } },
        team: { select: { name: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        memberships: { none: { projectId: id } },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.memberGroup.findMany({
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true },
            },
          },
          orderBy: { user: { name: "asc" } },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.salesTeam.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Phần họp đang tắt (ví dụ production) thì không tải dữ liệu và không hiện nút.
    showMeetings ? loadMeetingComposerData() : null,
    canEditApprovers
      ? prisma.user.findMany({
          where: {
            isActive: true,
            deletedAt: null,
            role: { in: [...FINANCE_APPROVER_ROLES] },
          },
          select: { id: true, name: true, email: true, avatarUrl: true, role: true },
          orderBy: { name: "asc" },
        })
      : [],
  ]);
  // Chọn sẵn thành viên dự án đang hoạt động; người tổ chức (người đang xem) không tự mời mình.
  const meetingAttendeeIds = project.members
    .filter((member) => member.user.isActive && member.userId !== user.id)
    .map((member) => member.userId);

  const members: MemberDTO[] = project.members.map((m) => ({
    userId: m.userId,
    role: m.role,
    user: m.user,
  }));

  const tasks: TaskDTO[] = project.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    result: t.result,
    status: t.status,
    priority: t.priority,
    startDate: t.startDate?.toISOString() ?? null,
    dueDate: t.dueDate?.toISOString() ?? null,
    order: t.order,
    assigneeId: t.assigneeId,
    creator: t.creator,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    comments: t.comments.map((c) => ({
      id: c.id,
      body: c.body,
      mentions: parseCommentMentions(c.mentions, c.body),
      createdAt: c.createdAt.toISOString(),
      author: c.author,
    })),
    followers: t.followers.map((f) => f.user),
    files: t.files.map((f) => ({
      id: f.id,
      kind: f.kind === "RESULT" ? "RESULT" : "BRIEF",
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      createdAt: f.createdAt.toISOString(),
      driveUrl: storedFileDriveUrl(f),
      uploader: f.uploader,
    })),
  }));

  const isOwner = project.ownerId === user.id;
  // Tab Tài chính chỉ có ở dự án Khách hàng (dự án Nội bộ không có báo giá/IC).
  const hasFinanceTab = showFinance && project.category === "CLIENT";
  const activeTab =
    tab === "webhook"
      ? "webhook"
      : tab === "files"
        ? "files"
        : tab === "finance" && hasFinanceTab
          ? "finance"
          : "tasks";
  const canManageWebhook = isMember || user.role === "ADMIN";
  const viewerGoogle =
    activeTab === "webhook"
      ? await prisma.user.findUnique({
          where: { id: user.id },
          select: { googleToken: true, googleScopes: true },
        })
      : null;
  const canViewRevenue = hasRevenueAccess(user.role) && project.category === "CLIENT";
  const initialTaskId = project.tasks.some((task) => task.id === requestedTaskId)
    ? requestedTaskId ?? null
    : null;

  // Tab Tài chính mở toàn màn hình (không thanh bên, đầu trang gọn) để bảng IC có đủ chỗ.
  if (activeTab === "finance") {
    const tabLinks = [
      { href: `/projects/${project.id}`, label: "Task" },
      { href: `/projects/${project.id}?tab=files`, label: "Tài liệu" },
      { href: `/projects/${project.id}?tab=webhook`, label: "Google Chat" },
    ];
    return (
      <div className="flex min-h-screen flex-col bg-[#f7f8fa] md:h-screen md:max-h-screen md:overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 bg-white px-4 py-2.5 sm:px-5">
          <Link
            href={`/projects/${project.id}`}
            className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Về dự án
          </Link>
          <span aria-hidden="true" className="hidden h-6 w-px bg-zinc-200 sm:block" />
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: projectStatusColor(project.status) }}
            />
            <h1 className="truncate text-base font-semibold text-zinc-950 sm:text-lg">
              {project.name}
              <span className="font-normal text-zinc-500"> · Báo giá &amp; IC</span>
            </h1>
          </div>
          <nav aria-label="Các tab khác của dự án" className="flex gap-1">
            {tabLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-[7px] px-3 py-1.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <ProjectFinancePanel projectId={project.id} viewer={{ id: user.id, role: user.role }} />
      </div>
    );
  }

  return (
    <ProjectBoardProvider>
      <div className="tf-shell">
        <Sidebar user={user} projects={sidebarProjects} activeProjectId={id} />

        <main className="tf-main flex flex-col overflow-hidden bg-white md:h-screen md:max-h-screen">
          <header className="border-b border-zinc-200/80 bg-white px-4 pt-3.5 pb-2 sm:px-6">
            {/* Top Row: Title, Status, Divider, Members (Left) | Budget, Chat, Actions (Right) */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: projectStatusColor(project.status),
                  }}
                  aria-hidden="true"
                />
                <h1 className="truncate text-base font-bold text-zinc-950 sm:text-lg">
                  {project.client?.name &&
                  !project.name
                    .toLowerCase()
                    .includes(project.client.name.toLowerCase()) ? (
                    <span className="font-semibold text-zinc-600">
                      [{project.client.name}]{" "}
                    </span>
                  ) : null}
                  {project.name}
                </h1>

                <ProjectStatusSelect
                  projectId={project.id}
                  status={project.status}
                  canEdit={isOwner || user.role === "ADMIN"}
                />

                <div className="mx-0.5 hidden h-4 w-px bg-zinc-200 sm:block" />

                <ProjectMembersPanel
                  projectId={project.id}
                  members={members}
                  availableUsers={availableUsers}
                  memberGroups={memberGroups
                    .map((group) => ({
                      id: group.id,
                      name: group.name,
                      members: group.members
                        .map((member) => member.user)
                        .filter(
                          (groupUser) =>
                            !project.members.some(
                              (projectMember) =>
                                projectMember.userId === groupUser.id
                            )
                        ),
                    }))
                    .filter((group) => group.members.length > 0)}
                  ownerId={project.ownerId}
                  currentUserId={user.id}
                />
              </div>

              <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
                {canViewRevenue && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-[#d6f0ab] bg-[#edf8d8] px-3.5 py-1 text-xs font-medium text-zinc-800 shadow-xs sm:text-sm">
                    <span className="font-normal text-zinc-500">Ngân sách:</span>
                    <span className="font-bold text-zinc-950">
                      {formatVND(project.revenue)}
                    </span>
                  </div>
                )}

                {project.googleChatSpaceUri && (
                  <a
                    href={project.googleChatSpaceUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#a3e635] px-3.5 py-1.5 text-xs font-semibold text-zinc-950 shadow-xs transition hover:bg-[#8fd822] sm:text-sm"
                  >
                    <MessagesSquare size={15} strokeWidth={2} aria-hidden="true" />
                    Nhóm Chat
                  </a>
                )}

                <ProjectActionsMenu
                  projectId={project.id}
                  isOwner={isOwner || user.role === "ADMIN"}
                >
                  {(isOwner || user.role === "ADMIN") && (
                    <ProjectEditButton
                      project={{
                        id: project.id,
                        name: project.name,
                        description: project.description,
                        type: project.type,
                        category: project.category,
                        responsibleTeamId: project.responsibleTeamId,
                        responsibleGroupId: project.responsibleGroupId,
                        hasPurchaseOrder: Boolean(project.purchaseOrderNumber),
                        executionStartAt: project.executionStartAt
                          ? toDateInputVN(project.executionStartAt)
                          : null,
                        executionEndAt: project.executionEndAt
                          ? toDateInputVN(project.executionEndAt)
                          : null,
                        revenue: hasRevenueAccess(user.role)
                          ? project.revenue
                          : null,
                        clientId: project.clientId,
                        clientName: project.client?.name ?? null,
                        accountId: project.accountId,
                        accountName:
                          project.account?.user?.name ??
                          project.account?.name ??
                          null,
                        icApproverId: project.icApproverId,
                        acApproverId: project.acApproverId,
                      }}
                      approverOptions={approverUsers.map((approver) => ({
                        id: approver.id,
                        name: approver.name,
                        email: approver.email,
                        avatarUrl: approver.avatarUrl,
                        meta: isUserRole(approver.role)
                          ? ROLE_LABELS[approver.role]
                          : null,
                      }))}
                      canEditApprovers={canEditApprovers}
                      clients={clients}
                      responsibilityOptions={{
                        teams,
                        groups: memberGroups.map(({ id, name }) => ({
                          id,
                          name,
                        })),
                      }}
                      accounts={accounts.map((account) => ({
                        id: account.id,
                        name:
                          account.user?.name ??
                          `${account.name} (dữ liệu cũ - cần liên kết)`,
                        email: account.user?.email ?? null,
                        avatarUrl: account.user?.avatarUrl ?? null,
                        meta: account.team.name,
                        teamName: account.team.name,
                      }))}
                      canEdit={isOwner || user.role === "ADMIN"}
                      canEditRevenue={hasRevenueAccess(user.role)}
                      renderTrigger={(openModal) => (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={openModal}
                          className="flex min-h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
                        >
                          <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
                          Sửa thông tin dự án
                        </button>
                      )}
                    />
                  )}

                  {meetingData && (
                    <MeetingComposer
                      {...meetingData.composerProps}
                      organizerId={user.id}
                      initialAttendeeIds={meetingAttendeeIds}
                      projectId={project.id}
                      triggerLabel="Tạo cuộc họp"
                      triggerClassName="flex min-h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
                    />
                  )}
                </ProjectActionsMenu>
              </div>
            </div>

            {/* Subheader Row: Tabs on left, Quick search / Filter / Create task on right */}
            <div className="mt-3 flex flex-col gap-2.5 border-t border-zinc-100 pt-2.5 sm:flex-row sm:items-center sm:justify-between">
              <nav
                className="tf-scroll-tabs flex items-center gap-1.5 overflow-x-auto text-xs sm:text-sm"
                aria-label="Project tabs"
              >
                <Link
                  href={`/projects/${project.id}`}
                  className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 font-medium transition-colors ${
                    activeTab === "tasks"
                      ? "bg-[#ebf8d8] font-semibold text-brand-950"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  <Kanban
                    size={14}
                    className={
                      activeTab === "tasks" ? "text-brand-800" : "text-zinc-400"
                    }
                  />
                  <span>Task</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                      activeTab === "tasks"
                        ? "bg-[#c8ee80] text-brand-950"
                        : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {tasks.length}
                  </span>
                </Link>

                <Link
                  href={`/projects/${project.id}?tab=files`}
                  className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 font-medium transition-colors ${
                    activeTab === "files"
                      ? "bg-[#ebf8d8] font-semibold text-brand-950"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  <FileText
                    size={14}
                    className={
                      activeTab === "files" ? "text-brand-800" : "text-zinc-400"
                    }
                  />
                  <span>Tài liệu</span>
                  {project.files.length > 0 && (
                    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
                      {project.files.length}
                    </span>
                  )}
                </Link>

                {hasFinanceTab && (
                  <Link
                    href={`/projects/${project.id}?tab=finance`}
                    className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                  >
                    <Banknote size={14} className="text-zinc-400" />
                    <span>Tài chính</span>
                  </Link>
                )}

                <Link
                  href={`/projects/${project.id}?tab=webhook`}
                  className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 font-medium transition-colors ${
                    activeTab === "webhook"
                      ? "bg-[#ebf8d8] font-semibold text-brand-950"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  <MessagesSquare
                    size={14}
                    className={
                      activeTab === "webhook"
                        ? "text-brand-800"
                        : "text-zinc-400"
                    }
                  />
                  <span>Google Chat</span>
                </Link>
              </nav>

              {activeTab === "tasks" && (
                <ProjectBoardToolbar members={members} />
              )}
            </div>
          </header>

        {activeTab === "webhook" ? (
          <div className="flex-1 space-y-4 overflow-auto bg-[#f7f8fa] p-4 sm:p-6">
            <ProjectChatSpacePanel
              projectId={project.id}
              space={
                project.googleChatSpaceUri
                  ? { uri: project.googleChatSpaceUri, creatorName: project.googleChatSpaceBy?.name ?? null }
                  : null
              }
              memberCount={project.members.length}
              canManage={canManageWebhook}
              canUnlink={isOwner || user.role === "ADMIN" || project.googleChatSpaceById === user.id}
              viewerConnected={Boolean(
                viewerGoogle?.googleToken &&
                  canManageChatSpaces(viewerGoogle.googleScopes) &&
                  (!chatAppConfigured() || canAddChatApp(viewerGoogle.googleScopes))
              )}
              configured={googleWorkspaceConfigured()}
              googleResult={googleResult ?? null}
              chatAppReady={chatAppConfigured()}
              chatAppProblem={chatAppProblem()}
              legacyWebhook={Boolean(project.googleChatWebhookUrl)}
            />
          </div>
        ) : activeTab === "files" ? (
          <div className="flex-1 overflow-auto bg-[#f7f8fa] p-4 sm:p-6">
            <ProjectFilesPanel
              projectId={project.id}
              currentUserId={user.id}
              canManageAll={isOwner || user.role === "ADMIN"}
              initialFiles={project.files.map(({ driveFileId, ...file }) => ({
                ...file,
                createdAt: file.createdAt.toISOString(),
                driveUrl: storedFileDriveUrl({ driveFileId, mimeType: file.mimeType }),
              }))}
            />
          </div>
        ) : (
          <Board
            projectId={project.id}
            tasks={tasks}
            members={members}
            currentUserId={user.id}
            initialTaskId={initialTaskId}
          />
        )}
        </main>
      </div>
    </ProjectBoardProvider>
  );
}
