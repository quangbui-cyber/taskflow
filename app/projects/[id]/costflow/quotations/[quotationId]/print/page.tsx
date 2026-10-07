import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getQuotationExport } from "@/lib/costflow/quotationExport";
import PrintCostFlow from "@/components/PrintCostFlow";
import CustomerQuotationView from "@/components/CustomerQuotationView";
export default async function PrintQuotation({ params }: { params: Promise<{ id: string; quotationId: string }> }) {
  const { id, quotationId } = await params;
  const saved = await getQuotationExport(id, quotationId, await requireUser());
  if (!saved) notFound();
  return <main className="tf-costflow-print mx-auto max-w-[1220px] p-6"><div className="tf-costflow-no-print mb-5"><Link className="tf-link" href={`/projects/${id}/costflow`}>← Về CostFlow</Link></div><PrintCostFlow /><strong>CREATIVE STATION</strong><CustomerQuotationView quotation={saved.customerQuotation} project={saved.project} /></main>;
}
