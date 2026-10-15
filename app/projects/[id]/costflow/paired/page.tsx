import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadPairedFinance } from "@/lib/costflow/pairedLoader";
import ModuleShell from "@/components/ModuleShell";
import CostFlowWorksheet from "@/components/CostFlowWorksheet";

export default async function PairedPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ quotationId?: string; draftId?: string; revisionId?: string }>;
}) {
  const { id } = await params;
  const { quotationId, draftId, revisionId } = await searchParams;
  const user = await requireUser();
  const loaded = await loadPairedFinance(id, user, { quotationId, draftId, revisionId });
  if (!loaded) notFound();
  const { finance, resolvedQuotationId } = loaded;
  return <ModuleShell user={user} projectId={id}>
    <div className="tf-module-page tf-costflow-page">
      <nav className="tf-module-breadcrumb" aria-label="Đường dẫn">
        <Link href={`/projects/${id}`}>{finance.project.name}</Link><span>›</span>
        <Link href={`/projects/${id}/costflow`}>CostFlow</Link><span>›</span><span>Báo giá & IC song song</span>
      </nav>
      <CostFlowWorksheet finance={finance} userId={user.id} quotationId={resolvedQuotationId} draftId={draftId} revisionId={revisionId} />
    </div>
  </ModuleShell>;
}
