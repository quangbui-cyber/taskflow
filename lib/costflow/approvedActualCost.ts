import "server-only";

import { prisma } from "@/lib/prisma";

export type ApprovedActualCostLine = {
  projectId: string;
  lineId?: string;
  versionId: string;
  approvalEventId: string;
  approvalAttemptId: string;
  approvalState: "APPROVED";
  stableLineId: string;
  recipientKey: string;
  fundingSource: "EMPLOYEE_ADVANCE" | "EMPLOYEE_OUT_OF_POCKET" | "VENDOR_ADVANCE" | "VENDOR_PAYMENT";
  approvedAmount: string;
};

export type ApprovedActualCostQuery = {
  projectId: string;
  versionId?: string;
  approvalEventId?: string;
  approvalAttemptId?: string;
  lineIds: string[];
  lineRefs?: { stableLineId: string; versionId: string; approvalEventId: string; approvalAttemptId: string }[];
};

export interface ApprovedActualCostConsumer {
  resolveApprovedLines(query: ApprovedActualCostQuery): Promise<ApprovedActualCostLine[]>;
}

export class ApprovedActualCostUnavailableError extends Error {
  constructor(message = "AC đã duyệt không khả dụng hoặc không khớp nguồn.") {
    super(message);
    this.name = "ApprovedActualCostUnavailableError";
  }
}

export async function resolveProductionApprovedActualCost(query: ApprovedActualCostQuery) {
  const refs = query.lineRefs?.length ? query.lineRefs : query.lineIds.map(stableLineId => ({
    stableLineId,
    versionId: query.versionId ?? "",
    approvalEventId: query.approvalEventId ?? "",
    approvalAttemptId: query.approvalAttemptId ?? "",
  }));
  if (!query.projectId || !refs.length || refs.some(ref => !ref.stableLineId || !ref.versionId || !ref.approvalEventId || !ref.approvalAttemptId)) {
    throw new ApprovedActualCostUnavailableError("Thiếu contract AC đã duyệt từ Phase 8.");
  }
  const rows = await prisma.actualCostLine.findMany({
    where: { projectId: query.projectId, stableLineId: { in: refs.map(ref => ref.stableLineId) } },
    include: { versions: { where: { id: { in: refs.map(ref => ref.versionId) }, state: "APPROVED" }, include: { approvals: true } } },
  });
  const lines = rows.flatMap(line => line.versions.flatMap(version => version.approvals
    .filter(approval => approval.action === "APPROVED")
    .map(approval => ({
      projectId: line.projectId,
      lineId: line.id,
      versionId: version.id,
      approvalEventId: approval.id,
      approvalAttemptId: approval.attemptId,
      approvalState: "APPROVED" as const,
      stableLineId: line.stableLineId,
      recipientKey: line.recipientKey,
      fundingSource: version.fundingSource as ApprovedActualCostLine["fundingSource"],
      approvedAmount: version.amount,
    }))));
  return validateApprovedActualCostLines({ ...query, lineIds: refs.map(ref => ref.stableLineId), lineRefs: refs }, lines);
}

export function validateApprovedActualCostLines(query: ApprovedActualCostQuery, lines: ApprovedActualCostLine[]) {
  const refs = query.lineRefs?.length ? query.lineRefs : query.lineIds.map(stableLineId => ({ stableLineId, versionId: query.versionId ?? "", approvalEventId: query.approvalEventId ?? "", approvalAttemptId: query.approvalAttemptId ?? "" }));
  if (!query.projectId || !refs.length || refs.some(ref => !ref.stableLineId || !ref.versionId || !ref.approvalEventId || !ref.approvalAttemptId)) throw new ApprovedActualCostUnavailableError("Thiếu contract AC đã duyệt từ Phase 8.");
  if (new Set(query.lineIds).size !== query.lineIds.length) throw new Error("Dòng AC được chọn bị trùng.");
  if (lines.length !== query.lineIds.length) throw new ApprovedActualCostUnavailableError("AC chưa có đủ dòng đã duyệt theo contract Phase 8.");
  for (const line of lines) {
    const ref = refs.find(item => item.stableLineId === line.stableLineId);
    if (!ref || line.projectId !== query.projectId || line.versionId !== ref.versionId || line.approvalEventId !== ref.approvalEventId || line.approvalAttemptId !== ref.approvalAttemptId || line.approvalState !== "APPROVED") {
      throw new ApprovedActualCostUnavailableError("AC đã duyệt không khớp Project, phiên bản hoặc approval event.");
    }
    if (!new Set(["EMPLOYEE_ADVANCE", "EMPLOYEE_OUT_OF_POCKET", "VENDOR_ADVANCE", "VENDOR_PAYMENT"]).has(line.fundingSource)) throw new Error("Nguồn thanh toán AC đã duyệt không hợp lệ.");
    if (!/^[1-9]\d*$/.test(line.approvedAmount)) throw new Error("Giá trị AC đã duyệt phải là số nguyên VND dương.");
  }
  return lines;
}
