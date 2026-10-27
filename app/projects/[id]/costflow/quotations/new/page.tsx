import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadFinance } from "@/lib/costflow/service";
import ModuleShell from "@/components/ModuleShell";
import CostFlowWorksheet from "@/components/CostFlowWorksheet";
import QuotationSourceChooser from "@/components/QuotationSourceChooser";
import { loadQuotationReuseCatalog } from "@/lib/costflow/quotationReuse";

export default async function QuotationPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ quotationId?: string; draftId?: string; start?: string }>;
}) {
  const { id } = await params;
  const { quotationId, draftId, start } = await searchParams;
  const user = await requireUser();
  const finance = await loadFinance(id, user);
  if (!finance || !finance.fullAccess || finance.data.closed || !["ACCOUNT", "ADMIN"].includes(user.role)) notFound();
  if (quotationId && !finance.data.quotations?.some(quotation => quotation.id === quotationId)) notFound();
  if (draftId && !finance.data.quotationDrafts?.some(draft => draft.id === draftId && draft.createdBy === user.id && (draft.workspaceMode ?? "paired") === "quote" && (!quotationId || draft.sourceQuotationId === quotationId || draft.latestQuotationId === quotationId))) notFound();
  if (!draftId && (quotationId || start === "blank")) {
    redirect(`/projects/${id}/costflow/paired${quotationId ? `?quotationId=${encodeURIComponent(quotationId)}` : ""}`);
  }
  const choosingSource = !quotationId && !draftId && start !== "blank";
  const catalog = choosingSource ? await loadQuotationReuseCatalog(id, user) : [];
  return <ModuleShell user={user} projectId={id}>
    <div className="tf-module-page tf-costflow-page">
      <nav className="tf-module-breadcrumb" aria-label="Đường dẫn">
        <Link href={`/projects/${id}`}>{finance.project.name}</Link><span>›</span>
        <Link href={`/projects/${id}/costflow`}>CostFlow</Link><span>›</span><span>Scope / Báo giá</span>
      </nav>
      {choosingSource
        ? <QuotationSourceChooser projectId={id} version={finance.version} items={catalog} />
        : <CostFlowWorksheet finance={JSON.parse(JSON.stringify(finance))} userId={user.id} mode="quote" quotationId={quotationId} draftId={draftId} />}
    </div>
  </ModuleShell>;
}
