import { Truck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { financeEnabled } from "@/lib/features";
import Sidebar from "@/components/Sidebar";
import FinanceSupplierDirectory from "@/components/SupplierDirectory";
import { SupplierDirectory as CostFlowSupplierDirectory } from "@/components/costflow/suppliers/SupplierDirectory";
import { listCompanySuppliers } from "@/lib/costflow/supplierReadModel";
import {
  canDeleteSuppliers,
  canManageSuppliers,
  type SupplierKind,
} from "@/lib/financePolicy";

export default async function SuppliersPage() {
  const user = await requireUser();
  const showFinanceDirectory = financeEnabled();
  const canManage = canManageSuppliers(user.role);
  const canDelete = canDeleteSuppliers(user.role);

  const [financeSuppliers, costFlowSuppliers, sidebarProjects] = await Promise.all([
    showFinanceDirectory
      ? prisma.financeSupplier.findMany({
          include: { updatedBy: { select: { name: true } } },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.$transaction((tx) => listCompanySuppliers(tx)),
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
  ]);

  // Xếp theo ABC kiểu tiếng Việt.
  const sorted = [...financeSuppliers].sort((a, b) =>
    a.name.localeCompare(b.name, "vi", { sensitivity: "base", numeric: true }),
  );

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="suppliers" />

      <main className="tf-main">
        <div className="tf-page space-y-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-800">
                <Truck size={20} aria-hidden="true" />
              </span>
              <h1 className="tf-page-title">Nhà cung cấp</h1>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-900">Danh bạ CostFlow đã xác minh</h2>
            <CostFlowSupplierDirectory
              suppliers={costFlowSuppliers}
              canEdit={user.role === "ADMIN" || user.role === "ACCOUNT"}
            />
          </section>

          {showFinanceDirectory && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-zinc-900">Danh bạ bảng tài chính</h2>
              <FinanceSupplierDirectory
                canManage={canManage}
                canDelete={canDelete}
                suppliers={sorted.map((supplier) => ({
                  id: supplier.id,
                  name: supplier.name,
                  shortName: supplier.shortName,
                  kind: (supplier.kind === "PERSON" ? "PERSON" : "COMPANY") as SupplierKind,
                  taxCode: supplier.taxCode,
                  phone: supplier.phone,
                  email: supplier.email,
                  bankAccount: supplier.bankAccount,
                  bankName: supplier.bankName,
                  accountHolder: supplier.accountHolder,
                  note: supplier.note,
                  updatedAt: supplier.updatedAt.toISOString(),
                  updatedByName: supplier.updatedBy?.name ?? null,
                }))}
              />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
