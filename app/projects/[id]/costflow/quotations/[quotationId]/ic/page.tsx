import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadFinance } from "@/lib/costflow/service";
import ModuleShell from "@/components/ModuleShell";
import CostFlowWorksheet from "@/components/CostFlowWorksheet";

export default async function IcFromQuotationPage({ params, searchParams }: {
  params: Promise<{ id: string; quotationId: string }>;
  searchParams: Promise<{ draftId?: string }>;
}) {
  const { id, quotationId } = await params;
  const { draftId } = await searchParams;
  const user = await requireUser();
  const finance = await loadFinance(id, user);
  if (!finance || !finance.fullAccess || finance.data.closed || !["ACCOUNT", "ADMIN"].includes(user.role)) notFound();
  if (quotationId && !finance.data.quotations?.some(quotation => quotation.id === quotationId)) notFound();
  if (draftId && !finance.data.quotationDrafts?.some(draft => draft.id === draftId && draft.createdBy === user.id && (draft.workspaceMode ?? "paired") === "ic" && (!quotationId || draft.sourceQuotationId === quotationId || draft.latestQuotationId === quotationId))) notFound();
  return <ModuleShell user={user} projectId={id}>
    <div className="tf-module-page tf-costflow-page">
      <nav className="tf-module-breadcrumb" aria-label="Đường dẫn">
        <Link href={`/projects/${id}`}>{finance.project.name}</Link><span>›</span>
        <Link href={`/projects/${id}/costflow`}>CostFlow</Link><span>›</span><span>IC từ báo giá</span>
      </nav>
      <CostFlowWorksheet finance={JSON.parse(JSON.stringify(finance))} userId={user.id} mode="ic" quotationId={quotationId} draftId={draftId} />
    </div>
  </ModuleShell>;
}
