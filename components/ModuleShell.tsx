import "server-only";
import type { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import { prisma } from "@/lib/prisma";
import type { requireUser } from "@/lib/auth";

/** Same membership-scoped navigation as the existing project/task screens. */
export default async function ModuleShell({ user, projectId, workflow = false, suppliers = false, children }: {
  user: Awaited<ReturnType<typeof requireUser>>;
  projectId?: string;
  workflow?: boolean;
  suppliers?: boolean;
  children: ReactNode;
}) {
  const projects = await prisma.project.findMany({
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
  });
  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeProjectId={projectId} activeSection={suppliers ? "suppliers" : workflow ? "workflow" : "home"} />
    <main className="tf-main tf-module-main">{children}</main>
  </div>;
}
