import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ModuleShell from "@/components/ModuleShell";
import { SupplierDirectory } from "@/components/costflow/suppliers/SupplierDirectory";
import { listCompanySuppliers } from "@/lib/costflow/supplierReadModel";

export default async function SuppliersPage() {
  const user = await requireUser();
  const suppliers = await prisma.$transaction(tx => listCompanySuppliers(tx));
  return <ModuleShell user={user} suppliers>
    <SupplierDirectory suppliers={suppliers} canEdit={user.role === "ADMIN" || user.role === "ACCOUNT"} />
  </ModuleShell>;
}
