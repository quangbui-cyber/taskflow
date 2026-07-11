import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageProjects, requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import Board from "@/components/Board";
import MembersBar from "@/components/MembersBar";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import ProjectEditButton from "@/components/ProjectEditButton";
import type { MemberDTO, TaskDTO } from "@/lib/types";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      account: { select: { id: true, name: true } },
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
      tasks: {
        include: {
          comments: {
            include: { author: { select: { id: true, name: true } } },
            orderBy: { createdAt: "asc" },
          },
          followers: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!project) notFound();
  const isMember = project.members.some((m) => m.userId === user.id);
  if (!isMember) redirect("/");

  const [sidebarProjects, clients, accounts, availableUsers] = await Promise.all([
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
      select: { id: true, name: true, color: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.client.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.account.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { memberships: { none: { projectId: id } } },
      select: { id: true, name: true, email: true, role: true },
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

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeProjectId={id} />

      <main className="tf-main flex flex-col overflow-hidden bg-white md:h-screen md:max-h-screen">
        <header className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 border-b border-zinc-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: project.color }}
            />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-zinc-950 sm:text-xl">{project.name}</h1>
              {project.description && (
                <p className="mt-0.5 truncate text-sm text-zinc-500">
                  {project.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
            <ProjectEditButton
              project={{
                id: project.id,
                name: project.name,
                description: project.description,
                status: project.status,
                revenue: project.revenue,
                clientId: project.clientId,
                clientName: project.client?.name ?? null,
                accountId: project.accountId,
                accountName: project.account?.name ?? null,
              }}
              clients={clients}
              accounts={accounts}
              canEdit={isOwner || user.role === "ADMIN"}
              showRevenue={canManageProjects(user.role)}
            />
            <MembersBar
              projectId={project.id}
              members={members}
              availableUsers={availableUsers}
              ownerId={project.ownerId}
              currentUserId={user.id}
            />
            {isOwner && <DeleteProjectButton projectId={project.id} />}
          </div>
        </header>

        <Board
          projectId={project.id}
          tasks={tasks}
          members={members}
          currentUserId={user.id}
        />
      </main>
    </div>
  );
}
