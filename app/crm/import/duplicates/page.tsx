import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import ClientMergeManager from "@/components/crm/ClientMergeManager";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled } from "@/lib/features";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { listDuplicateClientPairs } from "@/lib/crm/clientMerge";

export default async function DuplicateClientsPage() {
  const user = await requireUser();
  if (!crmEnabled()) notFound();
  const actor = await loadCrmActor(user);
  if (!crmCan(actor, "MERGE_CLIENT")) notFound();
  const pairs = await listDuplicateClientPairs(prisma);
  return <div className="tf-shell"><Sidebar user={user} activeSection="crmImport" />
    <main className="tf-main bg-zinc-50"><HubTabs section="crmImport" role={user.role} />
      <div className="tf-page space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="tf-page-title">Khách nghi trùng</h1>
          <Link href="/crm/import" className="tf-button-secondary">Rà dữ liệu nhập</Link>
        </header>
        <ClientMergeManager pairs={pairs} />
      </div>
    </main>
  </div>;
}
