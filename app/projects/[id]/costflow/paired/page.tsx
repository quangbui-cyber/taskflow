import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadFinance } from "@/lib/costflow/service";
import ModuleShell from "@/components/ModuleShell";
import CostFlowWorksheet from "@/components/CostFlowWorksheet";

export default async function PairedPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ quotationId?: string; draftId?: string }>;
}) {
  const { id } = await params;
  const { quotationId, draftId } = await searchParams;
  const user = await requireUser();
  const finance = await loadFinance(id, user);
  if (!finance || !finance.fullAccess || finance.data.closed || !["ACCOUNT", "ADMIN"].includes(user.role)) notFound();
  const resolvedQuotationId = quotationId ?? (draftId ? undefined : finance.data.quotations?.at(-1)?.id);
  if (resolvedQuotationId && !finance.data.quotations?.some(quotation => quotation.id === resolvedQuotationId)) notFound();
  if (draftId && !finance.data.quotationDrafts?.some(draft => draft.id === draftId && draft.createdBy === user.id && (draft.workspaceMode ?? "paired") === "paired" && (!resolvedQuotationId || draft.sourceQuotationId === resolvedQuotationId || draft.latestQuotationId === resolvedQuotationId))) notFound();
  return <ModuleShell user={user} projectId={id}>
    <div className="tf-module-page tf-costflow-page">
      <nav className="tf-module-breadcrumb" aria-label="Đường dẫn">
        <Link href={`/projects/${id}`}>{finance.project.name}</Link><span>›</span>
        <Link href={`/projects/${id}/costflow`}>CostFlow</Link><span>›</span><span>Báo giá & IC song song</span>
      </nav>
      <CostFlowWorksheet finance={JSON.parse(JSON.stringify(finance))} userId={user.id} quotationId={resolvedQuotationId} draftId={draftId} />
    </div>
  </ModuleShell>;
}
