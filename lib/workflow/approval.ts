export type ApprovalStep = { role: string; assigneeId: string };
export type ApprovalState = "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED" | "REJECTED" | "WITHDRAWN" | "CANCELLED";
export type ApprovalRecord = { creatorId: string; state: string; currentStep: number; steps: ApprovalStep[] };
export type Decision = "APPROVE" | "RETURN" | "REJECT" | "WITHDRAW";

export type DecisionPolicy = { reasonOptional?: boolean };

export function decide(record: ApprovalRecord, actorId: string, action: Decision, reason: string, policy: DecisionPolicy = {}) {
  if (action === "WITHDRAW") {
    if (actorId !== record.creatorId || !["SUBMITTED", "RETURNED"].includes(record.state)) throw new Error("Chỉ người lập được rút hồ sơ chưa hoàn tất duyệt.");
    if (!reason.trim()) throw new Error("Cần ghi lý do rút hồ sơ.");
    return { state: "WITHDRAWN" as ApprovalState, currentStep: record.currentStep };
  }
  if (record.state !== "SUBMITTED" || record.steps[record.currentStep]?.assigneeId !== actorId) {
    throw new Error("Bạn không được phân công xử lý bước hiện tại.");
  }
  if (action === "RETURN" || action === "REJECT") {
    if (!policy.reasonOptional && !reason.trim()) throw new Error("Cần ghi lý do trả hoặc từ chối hồ sơ.");
    return { state: action === "RETURN" ? "RETURNED" as const : "REJECTED" as const, currentStep: record.currentStep };
  }
  if (action !== "APPROVE") throw new Error("Quyết định không hợp lệ.");
  const currentStep = record.currentStep + 1;
  return { state: currentStep === record.steps.length ? "APPROVED" as const : "SUBMITTED" as const, currentStep };
}

export function validateSteps(steps: ApprovalStep[]) {
  if (!steps.length || steps.some(step => !step.role || !step.assigneeId)) throw new Error("Thiếu người duyệt. Bổ sung phân công trước khi gửi.");
  return steps;
}
