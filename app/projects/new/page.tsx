import { prisma } from "@/lib/prisma";
import { requireProjectManager } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import NewProjectForm from "@/components/NewProjectForm";

export default async function NewProjectPage() {
  const user = await requireProjectManager();

  const [sidebarProjects, clients, accounts] = await Promise.all([
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
      where: { userId: { not: null } },
      select: { id: true, user: { select: { name: true } } },
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
            }))}
          />
        </div>
      </main>
    </div>
  );
}
