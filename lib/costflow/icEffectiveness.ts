import type { IcRevision } from "./types";

export type IcRequestProjectionInput = {
  id: string;
  state: string;
  currentStep: number;
  steps: { role: string; assigneeId: string }[];
};

export type IcStatusProjection = {
  budgetLabel: "Đang có hiệu lực" | "Chưa có hiệu lực";
  approvalLabel: string;
  message: string;
  baselineRevisionId: string | null;
};

export function effectiveBaseline(revisions: IcRevision[]) {
  const effective = revisions.filter(revision => revision.effective);
  if (effective.length > 1) throw new Error("Project có nhiều IC hiệu lực; cần đối soát trước khi tiếp tục.");
  return effective[0];
}

export function icDecisionPolicy(kind: string, role: string | undefined, action: string) {
  const ceoOptional = kind === "IC" && role === "CEO" && ["RETURN", "REJECT"].includes(action);
  return { reasonOptional: ceoOptional, correctionsOptional: ceoOptional };
}

export function icStatusProjection(revision: IcRevision, request: IcRequestProjectionInput, revisions: IcRevision[]): IcStatusProjection {
  const baseline = effectiveBaseline(revisions);
  const budgetLabel = revision.effective ? "Đang có hiệu lực" : "Chưa có hiệu lực";
  let approvalLabel = request.state;
  if (request.state === "DRAFT") approvalLabel = revision.parentRevisionId ? "Nháp revision liên kết" : "Nháp";
  else if (request.state === "SUBMITTED") approvalLabel = request.steps[request.currentStep]?.role === "MANAGER" ? "Chờ Quản lý" : request.steps[request.currentStep]?.role === "ACCOUNTANT" ? "Chờ Kế toán" : request.steps[request.currentStep]?.role === "CEO" ? "Chờ CEO" : "Chờ xử lý";
  else if (request.state === "APPROVED") approvalLabel = "Đã được CEO duyệt";
  else if (request.state === "RETURNED") approvalLabel = "CEO trả để sửa";
  else if (request.state === "REJECTED") approvalLabel = "CEO từ chối";
  else if (request.state === "WITHDRAWN") approvalLabel = "Đã rút";
  else if (request.state === "CANCELLED") approvalLabel = "Đã hủy";

  let message: string;
  if (revision.effective && request.state === "SUBMITTED" && request.steps[request.currentStep]?.role !== "MANAGER") message = `IC-R${revision.number} đã có hiệu lực sau Quản lý duyệt; hồ sơ tiếp tục trình duyệt.`;
  else if (revision.effective && ["RETURNED", "REJECTED"].includes(request.state)) message = "Kết quả CEO không tự vô hiệu ngân sách và không phải quyền thanh toán.";
  else if (!revision.effective && baseline) message = `IC-R${revision.number} chưa có hiệu lực. Ngân sách hiện hành: IC-R${baseline.number}.`;
  else if (!revision.effective) message = "Project chưa có IC hiệu lực; chưa thể tạo phát sinh mới dựa trên IC.";
  else message = `IC-R${revision.number} đang là baseline ngân sách. Hiệu lực này không phải quyền thanh toán.`;

  return { budgetLabel, approvalLabel, message, baselineRevisionId: baseline?.id ?? null };
}

export function selectPrimaryIcRevision(revisions: IcRevision[], requests: IcRequestProjectionInput[], explicitId?: string) {
  if (explicitId) return revisions.find(revision => revision.id === explicitId);
  const submitted = revisions.find(revision => requests.find(request => request.id === revision.requestId)?.state === "SUBMITTED");
  const linkedDraft = revisions.find(revision => !!revision.parentRevisionId && requests.find(request => request.id === revision.requestId)?.state === "DRAFT");
  const draft = revisions.find(revision => requests.find(request => request.id === revision.requestId)?.state === "DRAFT");
  return submitted ?? linkedDraft ?? draft ?? effectiveBaseline(revisions);
}
