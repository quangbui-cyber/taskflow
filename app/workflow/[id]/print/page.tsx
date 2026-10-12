import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadDocument } from "@/lib/workflow/service";
import type { DocumentPayload } from "@/lib/workflow/documents";
import { readOwnSignatureAsset } from "@/lib/workflow/signatureAssets";
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
  const userSig = await readOwnSignatureAsset(user.id);
  const canAct = request.state === "SUBMITTED" && request.currentAssigneeId === user.id;

  let doc: WorkflowPrintDocument;
  if (request.state === "APPROVED") {
    const snapshot = await prisma.workflowApprovedSnapshot.findFirst({
      where: { requestId: request.id },
      orderBy: { version: "desc" },
    });
    if (!snapshot) notFound();
    const baseDoc = await approvedSnapshotPrintDocument(snapshot);
    doc = {
      ...baseDoc,
      projectName: request.project?.name,
      requestId: request.id,
      module: "WORKFLOW",
      version: request.version,
      attemptId: request.currentAttemptId,
      submittedVersion: request.submittedVersion,
      canAct: false,
      currentUser: { id: user.id, name: user.name, role: user.role },
      userProfileSignature: userSig?.dataUrl ?? null,
    };
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
      projectName: request.project?.name,
      requestId: request.id,
      module: "WORKFLOW",
      version: request.version,
      attemptId: request.currentAttemptId,
      submittedVersion: request.submittedVersion,
      canAct,
      currentActorRole: request.currentRole ?? undefined,
      currentStepIndex: request.currentStep,
      currentAssigneeId: request.currentAssigneeId ?? undefined,
      currentUser: { id: user.id, name: user.name, role: user.role },
      userProfileSignature: userSig?.dataUrl ?? null,
    };
  }
  return <WorkflowPrintView doc={doc} backHref={workflowDocumentHref(request.id)} />;
}
