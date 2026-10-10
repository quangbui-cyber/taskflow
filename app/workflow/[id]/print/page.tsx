import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadDocument } from "@/lib/workflow/service";
import type { DocumentPayload } from "@/lib/workflow/documents";
import { approvedSnapshotPrintDocument } from "@/lib/workflow/printDocument";
import { workflowDocumentHref } from "@/lib/workflow/routes";
import { WorkflowPrintView, type WorkflowPrintDocument } from "@/components/WorkflowPrintView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WorkflowPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await loadDocument(id, user);
  if (!detail) notFound();
  const request = detail.request;
  let doc: WorkflowPrintDocument;
  if (request.state === "APPROVED") {
    const snapshot = await prisma.workflowApprovedSnapshot.findFirst({ where: { requestId: request.id }, orderBy: { version: "desc" } });
    if (!snapshot) notFound();
    doc = await approvedSnapshotPrintDocument(snapshot);
  } else {
    const payload = request.payload as unknown as DocumentPayload;
    doc = {
      code: request.code,
      title: request.title,
      kind: request.kind,
      approvedAt: new Date(request.createdAt).toISOString(),
      creatorName: detail.users.find(person => person.id === request.creatorId)?.name ?? "Người lập",
      amount: payload.amount ?? "",
      content: payload.content ?? "",
      financeLines: [],
      signatures: [],
      isDraft: true,
    };
  }
  return <WorkflowPrintView doc={doc} backHref={workflowDocumentHref(request.id)} />;
}
