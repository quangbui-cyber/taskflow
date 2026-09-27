import Link from "next/link";
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  FileText,
  UsersRound,
} from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageProjects, requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import Board from "@/components/Board";
import MembersBar from "@/components/MembersBar";
import ProjectEditButton from "@/components/ProjectEditButton";
import ProjectActionsMenu from "@/components/ProjectActionsMenu";
import ProjectDescriptionDisclosure from "@/components/ProjectDescriptionDisclosure";
import ProjectWebhookPanel from "@/components/ProjectWebhookPanel";
import ProjectFilesPanel from "@/components/ProjectFilesPanel";
import ProjectStatusSelect from "@/components/ProjectStatusSelect";
import {
  formatVND,
  projectStatusColor,
  projectTypeInfo,
  type MemberDTO,
  type TaskDTO,
} from "@/lib/types";
import { formatExecutionRange, toDateInputVN } from "@/lib/dates";

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
  searchParams: Promise<{ tab?: string; task?: string }>;
}) {
  const { id } = await params;
  const { tab, task: requestedTaskId } = await searchParams;
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      account: {
        select: {
          id: true,
          name: true,
          user: { select: { name: true, email: true, avatarUrl: true } },
        },
      },
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
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

  const [sidebarProjects, clients, accounts, availableUsers, memberGroups] = await Promise.all([
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
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
    }),
    prisma.client.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.account.findMany({
      where: {
        OR: [
          { user: { isActive: true } },
          ...(project.accountId ? [{ id: project.accountId }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        userId: true,
        user: { select: { name: true, email: true, avatarUrl: true } },
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
  ]);

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
      uploader: f.uploader,
    })),
  }));

  const isOwner = project.ownerId === user.id;
  const activeTab =
    tab === "webhook" ? "webhook" : tab === "files" ? "files" : "tasks";
  const canManageWebhook = isOwner || user.role === "ADMIN";
  const canViewRevenue = canManageProjects(user.role);
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
                    executionStartAt: project.executionStartAt
                      ? toDateInputVN(project.executionStartAt)
                      : null,
                    executionEndAt: project.executionEndAt
                      ? toDateInputVN(project.executionEndAt)
                      : null,
                    revenue: project.revenue,
                    clientId: project.clientId,
                    clientName: project.client?.name ?? null,
                    accountId: project.accountId,
                    accountName:
                      project.account?.user?.name ??
                      project.account?.name ??
                      null,
                  }}
                  clients={clients}
                  accounts={accounts.map((account) => ({
                    id: account.id,
                    name:
                      account.user?.name ??
                      `${account.name} (dữ liệu cũ - cần liên kết)`,
                    email: account.user?.email ?? null,
                    avatarUrl: account.user?.avatarUrl ?? null,
                    meta: account.user ? null : "Dữ liệu cũ",
                  }))}
                  canEdit={isOwner || user.role === "ADMIN"}
                />
                {isOwner && <ProjectActionsMenu projectId={project.id} />}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500">
                <span className={`tf-badge ${typeInfo.className}`}>
                  {typeInfo.label}
                </span>
                {executionRange && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays size={14} aria-hidden="true" />
                    Thực hiện: {executionRange}
                  </span>
                )}
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
                <span
                  className={`inline-flex items-center gap-1.5 ${
                    accountName ? "" : "font-medium text-amber-600"
                  }`}
                >
                  <BriefcaseBusiness size={14} aria-hidden="true" />
                  {accountName ?? "Chưa gán Account"}
                </span>
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
              Webhook
            </Link>
          </nav>
        </header>

        {activeTab === "webhook" ? (
          <div className="flex-1 overflow-auto bg-[#f7f8fa] p-4 sm:p-6">
            <ProjectWebhookPanel
              projectId={project.id}
              configured={Boolean(project.googleChatWebhookUrl)}
              canManage={canManageWebhook}
            />
          </div>
        ) : activeTab === "files" ? (
          <div className="flex-1 overflow-auto bg-[#f7f8fa] p-4 sm:p-6">
            <ProjectFilesPanel
              projectId={project.id}
              currentUserId={user.id}
              canManageAll={isOwner || user.role === "ADMIN"}
              initialFiles={project.files.map((file) => ({
                ...file,
                createdAt: file.createdAt.toISOString(),
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
