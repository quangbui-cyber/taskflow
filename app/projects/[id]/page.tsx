import Link from "next/link";
import { parseCommentMentions } from "@/lib/commentMentions";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  FileText,
  MessagesSquare,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canViewRevenue as hasRevenueAccess, requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import Board from "@/components/Board";
import MembersBar from "@/components/MembersBar";
import ProjectEditButton from "@/components/ProjectEditButton";
import ProjectActionsMenu from "@/components/ProjectActionsMenu";
import ProjectDescriptionDisclosure from "@/components/ProjectDescriptionDisclosure";
import { chatAppConfigured, chatAppProblem } from "@/lib/googleChatApp";
import ProjectChatSpacePanel from "@/components/ProjectChatSpacePanel";
import { canAddChatApp, canManageChatSpaces, googleWorkspaceConfigured } from "@/lib/googleWorkspace";
import ProjectFilesPanel from "@/components/ProjectFilesPanel";
import ProjectFinancePanel from "@/components/ProjectFinancePanel";
import ProjectStatusSelect from "@/components/ProjectStatusSelect";
import MeetingComposer from "@/components/MeetingComposer";
import { meetingsEnabled } from "@/lib/features";
import { loadMeetingComposerData } from "@/lib/meetingComposerData";
import {
  formatVND,
  projectStatusColor,
  projectTypeInfo,
  projectCategoryInfo,
  type MemberDTO,
  type TaskDTO,
} from "@/lib/types";
import { formatExecutionRange, toDateInputVN } from "@/lib/dates";
import { FINANCE_APPROVER_ROLES, canSetFinanceApprovers } from "@/lib/financePolicy";
import { ROLE_LABELS, isUserRole } from "@/lib/roles";
import { storedFileDriveUrl } from "@/lib/storedFileResponse";

function extractProjectMetadata(description: string | null) {
  if (!description) return { poNumber: null, poDate: null };
  const lines = description.split(/\r?\n/).map((line) => line.trim());
  const poNumber =
    lines.find((line) => /^PO:\s*/i.test(line))?.replace(/^PO:\s*/i, "") ??
    null;
  const poDate =
    lines
      .find((line) => /^Ngày PO:\s*/i.test(line))
      ?.replace(/^Ngày PO:\s*/i, "") ?? null;
  return { poNumber, poDate };
}

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
  const canEditApprovers =
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
    dueDate: t.dueDate?.toISOString() ?? null,
    order: t.order,
    assigneeId: t.assigneeId,
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
  const hasFinanceTab = project.category === "CLIENT";
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
  const categoryInfo = projectCategoryInfo(project.category);
  const projectMetadata = extractProjectMetadata(project.description);
  const typeInfo = projectTypeInfo(project.type);
  const executionRange = formatExecutionRange(
    project.executionStartAt,
    project.executionEndAt
  );
  const accountName =
    project.account?.user?.name ?? project.account?.name ?? null;
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
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeProjectId={id} />

      <main className="tf-main flex flex-col overflow-hidden bg-white md:h-screen md:max-h-screen">
        <header className="border-b border-zinc-200 bg-white px-4 pt-4 sm:px-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor: projectStatusColor(project.status),
                  }}
                />
                <div className="min-w-0">
                  <h1 className="line-clamp-2 text-lg font-semibold text-zinc-950 sm:truncate sm:text-xl">
                    {project.name}
                  </h1>
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
                <ProjectStatusSelect
                  projectId={project.id}
                  status={project.status}
                  canEdit={isOwner || user.role === "ADMIN"}
                />
                {canViewRevenue && (
                  <span className="whitespace-nowrap px-1 text-sm font-semibold text-zinc-800">
                    {formatVND(project.revenue)}
                  </span>
                )}
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
                    revenue: hasRevenueAccess(user.role) ? project.revenue : null,
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
                    meta: isUserRole(approver.role) ? ROLE_LABELS[approver.role] : null,
                  }))}
                  canEditApprovers={canEditApprovers}
                  clients={clients}
                  responsibilityOptions={{
                    teams,
                    groups: memberGroups.map(({ id, name }) => ({ id, name })),
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
                />
                {meetingData && (
                  <MeetingComposer
                    {...meetingData.composerProps}
                    organizerId={user.id}
                    initialAttendeeIds={meetingAttendeeIds}
                    projectId={project.id}
                    triggerLabel="Tạo cuộc họp"
                    triggerClassName="tf-button-secondary !min-h-9 !px-3 !py-1.5 text-sm"
                  />
                )}
                {project.googleChatSpaceUri && (
                  <a
                    href={project.googleChatSpaceUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tf-button-secondary !min-h-9 !px-3 !py-1.5 text-sm"
                  >
                    <MessagesSquare size={15} strokeWidth={1.8} aria-hidden="true" />
                    Nhóm Chat
                  </a>
                )}
                {isOwner && <ProjectActionsMenu projectId={project.id} />}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500">
                <span className={`tf-badge ${categoryInfo.className}`}>
                  {categoryInfo.label}
                </span>
                {project.category === "CLIENT" && (
                  <span className={`tf-badge ${typeInfo.className}`}>
                    {typeInfo.label}
                  </span>
                )}
                {executionRange && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays size={14} aria-hidden="true" />
                    Thực hiện: {executionRange}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <UsersRound size={14} aria-hidden="true" />
                  {project.category === "CLIENT"
                    ? project.account?.team.name ?? "Cần gán Account"
                    : project.responsibleGroup?.name ?? project.responsibleTeam?.name ?? "Chưa gán Team/phòng ban"}
                </span>
                {project.client?.name && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 size={14} aria-hidden="true" />
                    {project.client.name}
                  </span>
                )}
                {projectMetadata.poNumber && (
                  <span className="inline-flex items-center gap-1.5">
                    <FileText size={14} aria-hidden="true" />
                    PO {projectMetadata.poNumber}
                  </span>
                )}
                {projectMetadata.poDate && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays size={14} aria-hidden="true" />
                    {projectMetadata.poDate}
                  </span>
                )}
                {project.category === "CLIENT" && (
                  <span
                    className={`inline-flex items-center gap-1.5 ${
                      accountName ? "" : "font-medium text-amber-600"
                    }`}
                  >
                    <BriefcaseBusiness size={14} aria-hidden="true" />
                    {accountName ?? "Cần gán Account"}
                  </span>
                )}
                {canViewRevenue && (
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck size={14} aria-hidden="true" />
                    Duyệt IC: {project.icApprover?.name ?? "chưa chọn"} · Duyệt AC:{" "}
                    {project.acApprover?.name ?? "chưa chọn"}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                  <UsersRound size={14} aria-hidden="true" />
                  {members.length} thành viên
                </span>
                <MembersBar
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
            </div>

            {project.description && (
              <ProjectDescriptionDisclosure
                description={project.description}
              />
            )}
          </div>

          <nav
            className="tf-scroll-tabs mt-3 flex gap-1 border-t border-zinc-100 py-3"
            aria-label="Project tabs"
          >
            <Link
              href={`/projects/${project.id}`}
              className={`rounded-[7px] px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "tasks"
                  ? "bg-brand-50 text-brand-800"
                  : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              Task
            </Link>
            {hasFinanceTab && (
              <Link
                href={`/projects/${project.id}?tab=finance`}
                className="rounded-[7px] px-3 py-1.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
              >
                Tài chính
              </Link>
            )}
            <Link
              href={`/projects/${project.id}?tab=files`}
              className={`rounded-[7px] px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "files"
                  ? "bg-brand-50 text-brand-800"
                  : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              Tài liệu
              {project.files.length > 0 && (
                <span className="ml-1.5 text-xs text-zinc-400">
                  {project.files.length}
                </span>
              )}
            </Link>
            <Link
              href={`/projects/${project.id}?tab=webhook`}
              className={`rounded-[7px] px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "webhook"
                  ? "bg-brand-50 text-brand-800"
                  : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              Google Chat
            </Link>
          </nav>
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
  );
}
