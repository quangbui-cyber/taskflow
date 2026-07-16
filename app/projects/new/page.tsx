import { prisma } from "@/lib/prisma";
import { requireProjectManager } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import NewProjectForm from "@/components/NewProjectForm";

export default async function NewProjectPage() {
  const user = await requireProjectManager();

  const [sidebarProjects, clients, accounts] = await Promise.all([
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
      where: { user: { isActive: true } },
      select: {
        id: true,
        user: { select: { name: true, email: true, avatarUrl: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} />

      <main className="tf-main">
        <div className="tf-page-narrow space-y-6">
          <div>
            <h1 className="tf-page-title">Tạo dự án mới</h1>
            <p className="tf-page-subtitle">
              Client và Account chọn từ Cài đặt.
            </p>
          </div>
          <NewProjectForm
            clients={clients}
            accounts={accounts.map((account) => ({
              id: account.id,
              name: account.user?.name ?? "",
              email: account.user?.email ?? null,
              avatarUrl: account.user?.avatarUrl ?? null,
            }))}
          />
        </div>
      </main>
    </div>
  );
}
