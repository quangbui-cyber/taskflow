import { Prisma } from "@prisma/client";

type ApprovalTokenRequest = {
  module: string;
  currentAttemptId: string | null;
  currentStep: number;
};

export function assertApprovalToken(
  request: ApprovalTokenRequest,
  form: FormData,
  submittedVersion: number | null,
) {
  const requestModule = String(form.get("module") ?? "");
  const attemptId = String(form.get("attemptId") ?? "");
  const stepIndex = Number(form.get("stepIndex"));
  const formSubmittedVersion = Number(form.get("submittedVersion"));
  if (
    requestModule !== request.module ||
    !request.currentAttemptId ||
    attemptId !== request.currentAttemptId ||
    !Number.isSafeInteger(stepIndex) ||
    stepIndex !== request.currentStep ||
    submittedVersion === null ||
    !Number.isSafeInteger(formSubmittedVersion) ||
    formSubmittedVersion !== submittedVersion
  ) {
    throw new Error("Hồ sơ hoặc bước duyệt đã thay đổi. Tải lại trước khi thao tác.");
  }
}

export function correctionItems(form: FormData, action: string, policy: { optional?: boolean } = {}) {
  if (action !== "RETURN") return [];
  const reason = String(form.get("reason") ?? "").trim();
  const items = form.getAll("correctionItems").map(String).map(item => item.trim()).filter(Boolean);
  if (!policy.optional && !reason) throw new Error("Trả hồ sơ cần lý do chung.");
  if (!policy.optional && !items.length) throw new Error("Trả hồ sơ cần ít nhất một nội dung phải sửa.");
  return items;
}

export type ApprovalEventInput = {
  requestId: string;
  module: string;
  attemptId?: string | null;
  submittedVersion?: number | null;
  mutationVersion: number;
  stepIndex: number;
  role: string;
  actorId: string;
  action: string;
  reason?: string;
  details?: Prisma.InputJsonValue;
  fromAssigneeId?: string | null;
  toAssigneeId?: string | null;
  recipients?: string[];
};

export async function recordApprovalEvent(
  tx: Prisma.TransactionClient,
  input: ApprovalEventInput,
) {
  const recipients = [...new Set(input.recipients ?? [])].filter(Boolean);
  return tx.workflowApprovalEvent.create({
    data: {
      requestId: input.requestId,
      module: input.module,
      attemptId: input.attemptId ?? null,
      submittedVersion: input.submittedVersion ?? null,
      mutationVersion: input.mutationVersion,
      stepIndex: input.stepIndex,
      role: input.role,
      actorId: input.actorId,
      action: input.action,
      reason: input.reason ?? "",
      details: input.details,
      fromAssigneeId: input.fromAssigneeId ?? null,
      toAssigneeId: input.toAssigneeId ?? null,
      deliveries: recipients.length
        ? { create: recipients.map((userId) => ({ userId })) }
        : undefined,
    },
  });
}
