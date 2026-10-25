import { Truck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import SupplierDirectory from "@/components/SupplierDirectory";
import {
  canDeleteSuppliers,
  canManageSuppliers,
  type SupplierKind,
} from "@/lib/financePolicy";

export default async function SuppliersPage() {
  const user = await requireUser();
  const canManage = canManageSuppliers(user.role);
  const canDelete = canDeleteSuppliers(user.role);

  const [suppliers, sidebarProjects] = await Promise.all([
    prisma.supplier.findMany({
      include: { updatedBy: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
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
  const sorted = [...suppliers].sort((a, b) =>
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
            <p className="tf-page-subtitle">
              {canManage
                ? "Danh bạ dùng chung cho IC, AC và phiếu đề nghị chi. Mọi người đều xem được thông tin chuyển khoản; Admin, Account và Kế toán được thêm và sửa."
                : "Danh bạ nhà cung cấp dùng chung, kèm thông tin chuyển khoản. Cần thêm hoặc sửa, hãy nhờ Account hoặc Kế toán."}
            </p>
          </div>

          <SupplierDirectory
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
        </div>
      </main>
    </div>
  );
}
