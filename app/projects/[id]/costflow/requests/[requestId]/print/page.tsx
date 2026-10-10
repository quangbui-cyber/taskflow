import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCostFlowPrintDocument } from "@/lib/costflow/exportData";
import { WorkflowPrintView } from "@/components/WorkflowPrintView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PrintCostFlowRequest({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id, requestId } = await params;
  const user = await requireUser();
  const printDoc = await getCostFlowPrintDocument(id, requestId, user);
  if (!printDoc) notFound();

  return (
    <WorkflowPrintView
      doc={printDoc}
      backHref={`/projects/${id}/costflow?tab=approvals#request-${requestId}`}
    />
  );
}
