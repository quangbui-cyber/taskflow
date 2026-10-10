import { getCurrentUser } from "@/lib/auth";
import { attachmentDisposition } from "@/lib/contentDisposition";
import { createRoundTripProjection } from "@/lib/costflow/excelRoundTrip";
import { createExcelRoundTripWorkbook } from "@/lib/costflow/quotationExcel";
import { hydrateLinePricingData } from "@/lib/costflow/pairedDraft";
import type { FinanceData } from "@/lib/costflow/types";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; draftId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { id, draftId } = await params;
  const [project, membership, workspace] = await Promise.all([
    prisma.project.findUnique({ where: { id }, select: { name: true } }),
    actor.role === "ADMIN" ? Promise.resolve({ userId: actor.id }) : prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: id, userId: actor.id } }, select: { userId: true } }),
    prisma.costFlowWorkspace.findUnique({ where: { projectId: id }, select: { data: true } }),
  ]);
  if (!project || !membership || !workspace || !["ADMIN", "ACCOUNT"].includes(actor.role)) return new Response("Not found", { status: 404 });
  const data = hydrateLinePricingData(workspace.data as unknown as FinanceData);
  const draft = data.quotationDrafts?.find(value => value.id === draftId);
  if (!draft || draft.createdBy !== actor.id || draft.workspaceMode !== "paired" || data.closed) return new Response("Not found", { status: 404 });
  if (draft.icRevisionId) {
    const revision = data.revisions.find(value => value.id === draft.icRevisionId);
    const request = revision ? await prisma.workflowRequest.findUnique({ where: { id: revision.requestId }, select: { state: true, creatorId: true } }) : null;
    if (!revision || revision.effective || request?.state !== "DRAFT" || request.creatorId !== actor.id) return new Response("Not found", { status: 404 });
  }
  const projection = createRoundTripProjection(id, draft);
  const bytes = await createExcelRoundTripWorkbook(projection, { projectName: project.name });
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": attachmentDisposition(`Bao-gia-IC-${project.name}-round-trip-v${draft.version}.xlsx`),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
