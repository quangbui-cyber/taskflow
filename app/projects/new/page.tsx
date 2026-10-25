import { prisma } from "@/lib/prisma";
import { canViewRevenue, requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import NewProjectForm from "@/components/NewProjectForm";
import { canCreateClient } from "@/lib/clientCatalog";

export default async function NewProjectPage() {
  const user = await requireUser();

  const [sidebarProjects, clients, accounts, teams, groups] = await Promise.all([
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
        user: { select: { name: true, email: true, avatarUrl: true } },
        team: { select: { name: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.salesTeam.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.memberGroup.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} />

      <main className="tf-main">
        <div className="tf-page-narrow space-y-6">
          <div>
            <h1 className="tf-page-title">Tạo dự án mới</h1>
          </div>
          <NewProjectForm
            canEditRevenue={canViewRevenue(user.role)}
            canCreateClient={canCreateClient(user.role)}
            clients={clients}
            responsibilityOptions={{ teams, groups }}
            accounts={accounts.map((account) => ({
              id: account.id,
              name: account.user?.name ?? "",
              email: account.user?.email ?? null,
              avatarUrl: account.user?.avatarUrl ?? null,
              teamName: account.team.name,
              meta: account.team.name,
            }))}
          />
        </div>
      </main>
    </div>
  );
}
