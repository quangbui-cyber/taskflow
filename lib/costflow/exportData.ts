import "server-only";
import { loadFinance } from "./service";
import { prisma } from "@/lib/prisma";
import type { RequestPayload } from "./types";
import type { ApprovalStep } from "@/lib/workflow/approval";
import { readOwnSignatureAsset } from "@/lib/workflow/signatureAssets";
import type { DetailedFinanceLine, WorkflowPrintDocument } from "@/components/WorkflowPrintView";
import { approvedSnapshotPrintDocument } from "@/lib/workflow/printDocument";

export async function getCostFlowPrintDocument(
  projectId: string,
  requestId: string,
  actor: { id: string; role: string }
): Promise<WorkflowPrintDocument | null> {
  const finance = await loadFinance(projectId, actor);
  const request = finance?.requests.find(r => r.id === requestId);
  if (!request || !finance) return null;
  const payload = request.payload as RequestPayload;
  const steps = (Array.isArray(request.steps) ? request.steps : []) as unknown as ApprovalStep[];

  // Build detailed itemized lines from payment dossier or payload
  const dossier = finance.paymentDossiers?.find(d => d.requestId === request.id);
  const detailedLines: DetailedFinanceLine[] = (dossier?.lines || []).map((line, idx) => {
    const recipient = dossier?.recipients?.find(r => r.recipientKey === line.recipientKey);
    const beneficiary = finance.data.beneficiaries?.find(
      b => b.id === line.recipientKey || `BENEFICIARY:${b.id}` === line.recipientKey
    );
    return {
      stt: idx + 1,
      id: line.id,
      description: line.description,
      icLineLabel: line.icLineId ? `Mục IC: ${line.icLineId.slice(-6)}` : undefined,
      amount: line.amount,
      recipientName: recipient?.displayName || beneficiary?.name || payload.beneficiary?.name || "—",
      recipientBank: recipient?.bankName || beneficiary?.bank || payload.beneficiary?.bank,
      recipientAccount:
        beneficiary?.account ||
        payload.beneficiary?.account ||
        (recipient?.accountLast4 ? `****${recipient.accountLast4}` : undefined),
    };
  });

  // Query actual digital signature events from database
  const signingEvents = await prisma.workflowSigningEvent.findMany({
    where: { requestId: request.id },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { signedAt: "asc" },
  });

  // Check current user's profile signature asset for fast 1-click signing
  const userSig = await readOwnSignatureAsset(actor.id);
  const currentUserObj = finance.users.find(u => u.id === actor.id);
  const creatorUser = finance.users.find(person => person.id === request.creatorId);

  // Map 4 roles: CREATOR, MANAGER, ACCOUNTANT, CEO
  const roles = ["CREATOR", "MANAGER", "ACCOUNTANT", "CEO"] as const;
  const signatures = roles
    .map(role => {
      const event = signingEvents.find(e => e.role === role);
      if (event) {
        return {
          role,
          name: event.actor.name,
          signedAt: event.signedAt.toISOString(),
          signaturePngUrl: `data:image/png;base64,${Buffer.from(event.signaturePngData).toString("base64")}`,
        };
      }
      // Check decisions
      const dec = request.decisions.find(d => {
        const step = steps.find(s => s.role === role);
        return step && d.actorId === step.assigneeId && d.action === "APPROVE";
      });
      if (dec) {
        const u = finance.users.find(user => user.id === dec.actorId);
        return {
          role,
          name: u?.name || "Đã duyệt",
          signedAt: dec.createdAt.toISOString(),
        };
      }
      // Creator signature attached at submission
      if (role === "CREATOR" && (payload as { signatureDataUrl?: string }).signatureDataUrl) {
        return {
          role,
          name: creatorUser?.name || "Người lập",
          signedAt: request.createdAt.toISOString(),
          signaturePngUrl: (payload as { signatureDataUrl?: string }).signatureDataUrl,
        };
      }
      return {
        role,
        name: "",
        signedAt: "",
      };
    })
    .filter(s => s.name);

  if (request.state === "APPROVED") {
    const snapshot = await prisma.workflowApprovedSnapshot.findFirst({
      where: { requestId: request.id },
      orderBy: { version: "desc" },
    });
    if (!snapshot) return null;
    const baseDoc = await approvedSnapshotPrintDocument(snapshot);
    return {
      ...baseDoc,
      projectName: finance.project.name,
      creatorDepartment: "Bộ phận Dự án",
      expectedSettlementDate: payload.expectedSettlementDate,
      createdDate: request.createdAt.toISOString(),
      detailedLines:
        detailedLines.length > 0
          ? detailedLines
          : baseDoc.financeLines.map((l, i) => ({
              stt: i + 1,
              id: l.id,
              description: l.description,
              amount: l.amount,
            })),
      signatures: signatures.length > 0 ? signatures : baseDoc.signatures,
      requestId: request.id,
      projectId,
      module: "COSTFLOW",
      version: finance.version,
      attemptId: request.currentAttemptId,
      submittedVersion:
        request.approvalEvents?.find(
          e => e.action === "SUBMIT" && e.attemptId === request.currentAttemptId
        )?.submittedVersion ?? null,
      canAct: false,
      currentUser: { id: actor.id, name: currentUserObj?.name, role: actor.role },
      userProfileSignature: userSig?.dataUrl ?? null,
    };
  }

  const current = steps[request.currentStep];
  const canAct = request.state === "SUBMITTED" && current?.assigneeId === actor.id;

  return {
    code: `CF-${request.id.slice(-8).toUpperCase()}`,
    title: request.title,
    kind: request.kind,
    approvedAt: request.createdAt.toISOString(),
    creatorName: creatorUser?.name ?? "Người đề nghị",
    creatorDepartment: "Bộ phận Dự án",
    projectName: finance.project.name,
    expectedSettlementDate: payload.expectedSettlementDate,
    createdDate: request.createdAt.toISOString(),
    amount: payload.amount ?? payload.actualGross ?? "",
    content: payload.explanation || request.title,
    financeLines: detailedLines.map(l => ({ id: l.id, description: l.description, amount: l.amount })),
    detailedLines,
    signatures,
    isDraft: true,
    requestId: request.id,
    projectId,
    module: "COSTFLOW",
    version: finance.version,
    attemptId: request.currentAttemptId,
    submittedVersion:
      request.approvalEvents?.find(
        e => e.action === "SUBMIT" && e.attemptId === request.currentAttemptId
      )?.submittedVersion ?? null,
    canAct,
    currentActorRole: current?.role,
    currentStepIndex: request.currentStep,
    currentAssigneeId: current?.assigneeId,
    currentUser: { id: actor.id, name: currentUserObj?.name, role: actor.role },
    userProfileSignature: userSig?.dataUrl ?? null,
  };
}

export async function getReimbursementExport(
  projectId: string,
  requestId: string,
  actor: { id: string; role: string }
) {
  const finance = await loadFinance(projectId, actor);
  const request = finance?.requests.find(r => r.id === requestId && r.kind === "REIMBURSEMENT");
  if (!request || !finance) return null;
  const payload = request.payload as RequestPayload;
  const user = payload.recipientKey?.startsWith("USER:")
    ? await prisma.user.findUnique({
        where: { id: payload.recipientKey.slice(5) },
        select: { name: true },
      })
    : null;
  const labels: Record<string, string> = {
    SUBMITTED: "Chờ duyệt",
    APPROVED: "Đã duyệt",
    RETURNED: "Đã trả",
    REJECTED: "Từ chối",
    WITHDRAWN: "Đã rút",
    CANCELLED: "Đã hủy",
  };
  return {
    id: request.id,
    title: request.title,
    project: finance.project.name,
    requester: user?.name ?? "Nhân viên",
    createdDate: request.createdAt.toLocaleDateString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
    }),
    approval: labels[request.state] ?? request.state,
    payload,
  };
}
