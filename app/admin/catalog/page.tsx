import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import CatalogManager from "@/components/CatalogManager";
import AccountCatalogManager from "@/components/AccountCatalogManager";
import {
  createClient,
  createSalesTeam,
  deleteClient,
  deleteSalesTeam,
} from "@/app/actions/catalog";
import { BarChart3 } from "lucide-react";

export default async function CatalogPage() {
  const admin = await requireAdmin();

  const [clients, accounts, salesTeams, sidebarProjects] = await Promise.all([
    prisma.client.findMany({
      include: { _count: { select: { projects: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.account.findMany({
      include: {
        team: { select: { id: true, name: true } },
        _count: { select: { projects: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.salesTeam.findMany({
      include: { _count: { select: { accounts: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { members: { some: { userId: admin.id } } },
      select: { id: true, name: true, color: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="tf-shell">
      <Sidebar user={admin} projects={sidebarProjects} activeSection="catalog" />

      <main className="tf-main">
        <div className="tf-page space-y-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="tf-page-title">Client, Account & Team</h1>
              <p className="tf-page-subtitle">
                Danh mục do admin tạo sẵn. Khi tạo project, người dùng chỉ chọn
                từ các mục ở đây.
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

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <CatalogManager
              title="Client"
              hint="Nhóm khách hàng để phân loại và theo dõi doanh số."
              placeholder="Tên client, ví dụ: Ngân hàng ABC"
              items={clients.map((c) => ({
                id: c.id,
                name: c.name,
                projectCount: c._count.projects,
              }))}
              createAction={createClient}
              deleteAction={deleteClient}
            />
            <AccountCatalogManager
              accounts={accounts.map((a) => ({
                id: a.id,
                name: a.name,
                projectCount: a._count.projects,
                teamId: a.teamId,
              }))}
              teams={salesTeams.map((team) => ({ id: team.id, name: team.name }))}
            />
            <CatalogManager
              title="Team kinh doanh"
              hint="Nhóm các Account để so sánh hiệu suất kinh doanh."
              placeholder="Tên team, ví dụ: Team Sales 1"
              items={salesTeams.map((team) => ({
                id: team.id,
                name: team.name,
                projectCount: team._count.accounts,
              }))}
              createAction={createSalesTeam}
              deleteAction={deleteSalesTeam}
              countLabel="account"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
