import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageProjects, requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import Board from "@/components/Board";
import MembersBar from "@/components/MembersBar";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import ProjectEditButton from "@/components/ProjectEditButton";
import ProjectWebhookPanel from "@/components/ProjectWebhookPanel";
import ProjectStatusSelect from "@/components/ProjectStatusSelect";
import { projectStatusColor, type MemberDTO, type TaskDTO } from "@/lib/types";

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
        },
        orderBy: { order: "asc" },
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
  }));

  const isOwner = project.ownerId === user.id;
  const activeTab = tab === "webhook" ? "webhook" : "tasks";
  const canManageWebhook = isOwner || user.role === "ADMIN";
  const initialTaskId = project.tasks.some((task) => task.id === requestedTaskId)
    ? requestedTaskId ?? null
    : null;

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeProjectId={id} />

      <main className="tf-main flex flex-col overflow-hidden bg-white md:h-screen md:max-h-screen">
        <header className="border-b border-zinc-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex min-h-[56px] flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: projectStatusColor(project.status) }}
              />
              <div className="min-w-0">
                <h1 className="line-clamp-2 text-lg font-semibold text-zinc-950 sm:truncate sm:text-xl">
                  {project.name}
                </h1>
                {project.description && (
                  <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500 sm:truncate">
                    {project.description}
                  </p>
                )}
              </div>
            </div>
            <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2 sm:w-auto sm:flex-1 sm:justify-end sm:gap-3">
              <ProjectStatusSelect
                projectId={project.id}
                status={project.status}
                canEdit={isOwner || user.role === "ADMIN"}
              />
              <ProjectEditButton
                project={{
                  id: project.id,
                  name: project.name,
                  description: project.description,
                  revenue: project.revenue,
                  clientId: project.clientId,
                  clientName: project.client?.name ?? null,
                  accountId: project.accountId,
                  accountName:
                    project.account?.user?.name ?? project.account?.name ?? null,
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
                showRevenue={canManageProjects(user.role)}
              />
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
                            (projectMember) => projectMember.userId === groupUser.id
                          )
                      ),
                  }))
                  .filter((group) => group.members.length > 0)}
                ownerId={project.ownerId}
                currentUserId={user.id}
              />
              {isOwner && <DeleteProjectButton projectId={project.id} />}
            </div>
          </div>

          <nav
            className="tf-scroll-tabs mt-4 flex gap-1 border-t border-zinc-100 pt-3"
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
