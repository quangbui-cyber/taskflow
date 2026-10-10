import "server-only";
import { loadFinance } from "./service";
import { prisma } from "@/lib/prisma";
import type { RequestPayload } from "./types";

import type { WorkflowPrintDocument } from "@/components/WorkflowPrintView";
import { approvedSnapshotPrintDocument } from "@/lib/workflow/printDocument";

export async function getCostFlowPrintDocument(projectId: string, requestId: string, actor: { id: string; role: string }): Promise<WorkflowPrintDocument | null> {
  const finance = await loadFinance(projectId, actor);
  const request = finance?.requests.find(r => r.id === requestId);
  if (!request || !finance) return null;
  const payload = request.payload as RequestPayload;
  if (request.state === "APPROVED") {
    const snapshot = await prisma.workflowApprovedSnapshot.findFirst({ where: { requestId: request.id }, orderBy: { version: "desc" } });
    if (!snapshot) return null;
    return approvedSnapshotPrintDocument(snapshot);
  }
  return {
    code: `CF-${request.id.slice(-8).toUpperCase()}`,
    title: request.title,
    kind: request.kind,
    approvedAt: request.createdAt.toISOString(),
    creatorName: finance.users.find(person => person.id === request.creatorId)?.name ?? "Người đề nghị",
    amount: payload.amount ?? payload.actualGross ?? "",
    content: payload.explanation || request.title,
    financeLines: [],
    signatures: [],
    isDraft: true,
  };
}

export async function getReimbursementExport(projectId: string, requestId: string, actor: { id: string; role: string }) {
  const finance = await loadFinance(projectId, actor);
  const request = finance?.requests.find(r => r.id === requestId && r.kind === "REIMBURSEMENT");
  if (!request || !finance) return null;
  const payload = request.payload as RequestPayload;
  const user = payload.recipientKey?.startsWith("USER:") ? await prisma.user.findUnique({ where: { id: payload.recipientKey.slice(5) }, select: { name: true } }) : null;
  const labels: Record<string, string> = { SUBMITTED: "Chờ duyệt", APPROVED: "Đã duyệt", RETURNED: "Đã trả", REJECTED: "Từ chối", WITHDRAWN: "Đã rút", CANCELLED: "Đã hủy" };
  return { id: request.id, title: request.title, project: finance.project.name, requester: user?.name ?? "Nhân viên", createdDate: request.createdAt.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }), approval: labels[request.state] ?? request.state, payload };
}
