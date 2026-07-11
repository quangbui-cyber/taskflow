import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import CreateUserForm from "@/components/CreateUserForm";
import UserRow from "@/components/UserRow";
import Link from "next/link";
import { BarChart3 } from "lucide-react";

export default async function AdminPage() {
  const admin = await requireAdmin();

  const [users, sidebarProjects] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        managerId: true,
        createdAt: true,
        _count: {
          select: {
            assignedTasks: true,
            memberships: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.project.findMany({
      where: { members: { some: { userId: admin.id } } },
      select: { id: true, name: true, color: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="tf-shell">
      <Sidebar user={admin} projects={sidebarProjects} activeSection="admin" />

      <main className="tf-main">
        <div className="tf-page space-y-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="tf-page-title">Quản trị người dùng</h1>
              <p className="tf-page-subtitle">
                Tạo và quản lý tài khoản cho nhân viên trong công ty.
              </p>
            </div>
            <Link
              href="/team"
              className="tf-button-secondary"
            >
              <BarChart3 size={16} aria-hidden="true" />
              Đội & Hiệu suất
            </Link>
          </div>

          <CreateUserForm />

          <div className="tf-panel overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between">
              <h2 className="font-semibold">Tài khoản ({users.length})</h2>
            </div>
            <ul className="divide-y divide-zinc-100">
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={{
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    role: u.role,
                    managerId: u.managerId,
                    createdAt: u.createdAt.toISOString(),
                    taskCount: u._count.assignedTasks,
                    projectCount: u._count.memberships,
                  }}
                  isSelf={u.id === admin.id}
                  managers={users.map((m) => ({ id: m.id, name: m.name }))}
                />
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
