export type ApprovedActualCostLine = {
  projectId: string;
  versionId: string;
  approvalEventId: string;
  approvalAttemptId: string;
  approvalState: "APPROVED";
  stableLineId: string;
  recipientKey: string;
  approvedAmount: string;
};

export type ApprovedActualCostQuery = {
  projectId: string;
  versionId: string;
  approvalEventId: string;
  approvalAttemptId: string;
  lineIds: string[];
};

export interface ApprovedActualCostConsumer {
  resolveApprovedLines(query: ApprovedActualCostQuery): Promise<ApprovedActualCostLine[]>;
}

export class ApprovedActualCostUnavailableError extends Error {
  constructor(message = "Approved AC producer unavailable until Phase 8.") {
    super(message);
    this.name = "ApprovedActualCostUnavailableError";
  }
}

export const unavailableApprovedActualCostConsumer: ApprovedActualCostConsumer = {
  async resolveApprovedLines() {
    throw new ApprovedActualCostUnavailableError();
  },
};

// Phase 8 replaces only this producer binding once it owns persisted AC versions and approval events.
// Phase 7 must never infer approval from invoice/payment-proof completeness.
export async function resolveProductionApprovedActualCost(query: ApprovedActualCostQuery) {
  return validateApprovedActualCostLines(query, await unavailableApprovedActualCostConsumer.resolveApprovedLines(query));
}

export function validateApprovedActualCostLines(query: ApprovedActualCostQuery, lines: ApprovedActualCostLine[]) {
  if (!query.projectId || !query.versionId || !query.approvalEventId || !query.approvalAttemptId || !query.lineIds.length) throw new ApprovedActualCostUnavailableError("Thiếu contract AC đã duyệt từ Phase 8.");
  if (new Set(query.lineIds).size !== query.lineIds.length) throw new Error("Dòng AC được chọn bị trùng.");
  if (lines.length !== query.lineIds.length) throw new ApprovedActualCostUnavailableError("AC chưa có đủ dòng đã duyệt theo contract Phase 8.");
  for (const line of lines) {
    if (line.projectId !== query.projectId || line.versionId !== query.versionId || line.approvalEventId !== query.approvalEventId || line.approvalAttemptId !== query.approvalAttemptId || line.approvalState !== "APPROVED" || !query.lineIds.includes(line.stableLineId)) {
      throw new ApprovedActualCostUnavailableError("AC đã duyệt không khớp Project, phiên bản hoặc approval event.");
    }
    if (!/^[1-9]\d*$/.test(line.approvedAmount)) throw new Error("Giá trị AC đã duyệt phải là số nguyên VND dương.");
  }
  return lines;
}
