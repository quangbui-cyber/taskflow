import type { ApprovalStep } from "./approval";
import type { Requirements } from "./requirements";

export const TEMPLATE_KINDS = {
  PROPOSAL: "Tờ trình nội bộ",
  PROPOSAL_ADVANCE: "Phiếu đề nghị tạm ứng",
  PROPOSAL_ADVANCE_SETTLEMENT: "Phiếu đề nghị hoàn tạm ứng",
  SERVICE_CONTRACT: "Hợp đồng dịch vụ",
} as const;
export type DocumentPayload = {
  content: string;
  counterparty: string;
  amount: string;
  linkedRequestId: string;
  mainFileId: string;
  supportingFiles?: Record<string,string>;
  submittedFiles?: {schemaVersion:1;mainFileId:string;supportingFiles:Record<string,string>;referenceFileIds:string[]};
  templateSnapshot?: { name: string; version: number; instructions: string; signerNames: string; fileId: string; ownerId: string; accountantId: string; ceoId: string; requirements?: Requirements; familyId?:string; category?:string; purpose?:string; changeNote?:string; requiresExecutionTracking?: boolean };
  responsibleManagerId?: string;
  resubmission?: { sourceRequestId: string; sourceAttemptId: string; response: string };
  cancellation?: { status: "PENDING" | "CONFIRMED" | "REJECTED"; requestedById: string; requestedAt: string; reason: string; decidedById?: string; decidedAt?: string; decisionReason?: string };
  execution?: { startedAt?: string; startedById?: string };
  signature?: { state: "PENDING" | "RETURNED" | "CONFIRMED"; fileId: string; keeper: string; location: string; confirmedBy?: string; confirmedAt?: string };
};
export const isTemplateKind = (value: string): value is keyof typeof TEMPLATE_KINDS => Object.prototype.hasOwnProperty.call(TEMPLATE_KINDS, value);
export function documentReader(request: { creatorId: string; steps: unknown; payload?: unknown }, actorId: string, admin: boolean, member: boolean) {
  return admin || member || request.creatorId === actorId || (request.steps as ApprovalStep[]).some(step => step.assigneeId === actorId) || (request.payload as DocumentPayload | undefined)?.responsibleManagerId === actorId;
}
export const WORKFLOW_MIME = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/jpeg", "image/png"]);
export function assertWorkflowFile(file: { size: number; mimeType: string; name: string }) {
  if (!file.size || file.size > 4 * 1024 * 1024 || !WORKFLOW_MIME.has(file.mimeType) || !/\.(pdf|docx|xlsx|jpe?g|png)$/i.test(file.name)) throw new Error("Chỉ nhận PDF/DOCX/XLSX/JPG/PNG, tối đa 4 MB mỗi tệp.");
}
