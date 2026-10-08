import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProjectUpload } from "@/lib/projectFiles";

type Actor = { id: string; role: string };
type AllocationInput = { requestLineId: string; amount: string };

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function required(value: string, label: string) {
  if (!value) throw new Error(`Thiếu ${label}.`);
  return value;
}

export function exactVnd(value: string, label = "số tiền") {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} phải là số nguyên VND lớn hơn 0.`);
  return BigInt(value);
}

export type PaymentProgress = "CHUA_CHI" | "DANG_CHI_MOT_PHAN" | "DA_CHI_DU";

export function derivePaymentProgress(approvedAmount: string, paidOutAmount: string) {
  const approved = exactVnd(approvedAmount, "số tiền được duyệt");
  const paid = /^\d+$/.test(paidOutAmount) ? BigInt(paidOutAmount) : BigInt(-1);
  if (paid < BigInt(0) || paid > approved) throw new Error("Tiến độ chi vượt số tiền được duyệt.");
  const progress: PaymentProgress = paid === BigInt(0) ? "CHUA_CHI" : paid === approved ? "DA_CHI_DU" : "DANG_CHI_MOT_PHAN";
  return { progress, approvedAmount: approved.toString(), paidOutAmount: paid.toString(), remainingAmount: (approved - paid).toString() };
}

function parseAllocations(form: FormData) {
  let value: unknown;
  try { value = JSON.parse(text(form, "allocations") || "[]"); } catch { throw new Error("Phân bổ giao dịch không hợp lệ."); }
  if (!Array.isArray(value) || value.length === 0) throw new Error("Cần phân bổ giao dịch vào ít nhất một khoản đã duyệt.");
  const allocations = value as AllocationInput[];
  if (allocations.some(item => !item || typeof item.requestLineId !== "string" || typeof item.amount !== "string")) throw new Error("Phân bổ giao dịch không hợp lệ.");
  if (new Set(allocations.map(item => item.requestLineId)).size !== allocations.length) throw new Error("Không được phân bổ trùng một khoản.");
  allocations.forEach(item => exactVnd(item.amount, "số tiền phân bổ"));
  return [...allocations].sort((a, b) => a.requestLineId.localeCompare(b.requestLineId));
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function executeOnce(projectId: string, expectedVersion: number, actor: Actor, form: FormData, upload: ProjectUpload | null) {
  return prisma.$transaction(async tx => {
    const requestId = required(text(form, "requestId"), "hồ sơ thanh toán");
    const recipientKey = required(text(form, "recipientKey"), "người nhận");
    const direction = required(text(form, "direction"), "chiều giao dịch");
    const idempotencyKey = required(text(form, "idempotencyKey"), "mã chống ghi trùng");
    const channel = required(text(form, "channel"), "hình thức giao dịch");
    const reference = required(text(form, "reference"), "mã giao dịch/chứng từ duy nhất");
    const amount = exactVnd(required(text(form, "amount"), "số tiền"));
    const allocations = parseAllocations(form);
    const occurredAt = new Date(required(text(form, "occurredAt"), "thời điểm giao dịch"));
    if (!Number.isFinite(occurredAt.getTime())) throw new Error("Thời điểm giao dịch không hợp lệ.");
    if (direction !== "OUT") throw new Error("Thu hoàn sau AC chưa khả dụng cho đến khi Phase 8 cung cấp AC đã duyệt.");
    if (!new Set(["BANK_TRANSFER", "CASH", "OTHER"]).has(channel)) throw new Error("Hình thức giao dịch không hợp lệ.");

    const currentActor = await tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { role: true } });
    if (!currentActor || !["ACCOUNT", "ADMIN"].includes(currentActor.role)) throw new Error("Chỉ Account/Admin đang hoạt động được xác nhận tiền thực tế.");
    const request = await tx.workflowRequest.findFirst({
      where: { id: requestId, projectId, module: "COSTFLOW" },
      include: { paymentRecipients: true, paymentLines: true },
    });
    if (!request || request.state !== "APPROVED" || request.cashAssigneeId !== actor.id) throw new Error("Chỉ người được giao xử lý tiền cho hồ sơ đã duyệt mới xác nhận tiền.");
    if (request.kind !== "ADVANCE") throw new Error("Thanh toán/hoàn ứng sau AC chưa khả dụng cho đến khi Phase 8 cung cấp AC đã duyệt.");
    const recipient = request.paymentRecipients.find(item => item.recipientKey === recipientKey);
    if (!recipient) throw new Error("Người nhận không thuộc phiên bản hồ sơ đã duyệt.");

    let evidence: { sourceFileId: string; name: string; mimeType: string; data: Uint8Array<ArrayBuffer>; sha256: string };
    if (upload) {
      evidence = { sourceFileId: "uploaded-cash-proof", name: upload.name, mimeType: upload.mimeType, data: upload.data, sha256: createHash("sha256").update(upload.data).digest("hex") };
    } else {
      const sourceFileId = required(text(form, "sourceFileId"), "chứng từ chuyển tiền");
      const file = await tx.projectFile.findFirst({ where: { id: sourceFileId, projectId } });
      if (!file) throw new Error("Chứng từ không thuộc Project này.");
      evidence = { sourceFileId: file.id, name: file.name, mimeType: file.mimeType, data: new Uint8Array(file.data), sha256: createHash("sha256").update(file.data).digest("hex") };
    }

    const canonical = {
      projectId, requestId, recipientKey, direction, amount: amount.toString(), allocations,
      occurredAt: occurredAt.toISOString(), channel, reference, evidenceSha256: evidence.sha256,
    };
    const commandFingerprint = fingerprint(canonical);
    const existing = await tx.costFlowCash.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey } } });
    if (existing) {
      if (existing.commandFingerprint !== commandFingerprint) throw new Error("Mã chống ghi trùng đã được dùng cho một giao dịch khác.");
      const workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId }, select: { version: true } });
      return { success: "Giao dịch đã được ghi nhận trước đó.", requestId, cashId: existing.id, version: workspace?.version ?? expectedVersion, idempotent: true };
    }

    const lines = request.paymentLines.filter(line => allocations.some(item => item.requestLineId === line.id));
    if (lines.length !== allocations.length || lines.some(line => line.projectId !== projectId || line.requestId !== requestId || line.recipientKey !== recipientKey)) throw new Error("Chỉ được phân bổ vào các khoản cùng người nhận trong đúng hồ sơ và Project.");
    const allocationTotal = allocations.reduce((sum, item) => sum + exactVnd(item.amount, "số tiền phân bổ"), BigInt(0));
    if (allocationTotal !== amount) throw new Error("Tổng phân bổ phải bằng đúng số tiền giao dịch.");

    const prior = await tx.costFlowCashAllocation.findMany({ where: { projectId, requestId, recipientKey, direction: "OUT" } });
    const paidByLine = new Map<string, bigint>();
    for (const item of prior) paidByLine.set(item.requestLineId, (paidByLine.get(item.requestLineId) ?? BigInt(0)) + BigInt(item.amount));
    for (const allocation of allocations) {
      const line = lines.find(item => item.id === allocation.requestLineId)!;
      if ((paidByLine.get(line.id) ?? BigInt(0)) + BigInt(allocation.amount) > BigInt(line.amount)) throw new Error("Giao dịch vượt số tiền còn lại của khoản đã duyệt.");
    }
    const paidRecipient = prior.reduce((sum, item) => sum + BigInt(item.amount), BigInt(0));
    if (paidRecipient + amount > BigInt(recipient.totalAmount)) throw new Error("Giao dịch vượt số tiền còn lại của người nhận.");

    const workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId } });
    if (!workspace) throw new Error("Chưa có không gian CostFlow cho Project.");
    const workspaceData = workspace.data as { closed?: boolean };
    if (workspaceData.closed) throw new Error("Tài chính Project đã đóng, không thể ghi thêm giao dịch.");
    if (workspace.version !== expectedVersion) throw new Error("Dữ liệu đã thay đổi. Tải lại để tránh ghi trùng.");
    const savedEvidence = await tx.costFlowEvidence.create({ data: { projectId, requestId, sourceFileId: evidence.sourceFileId, kind: "CASH", name: evidence.name, mimeType: evidence.mimeType, data: evidence.data, sha256: evidence.sha256, createdBy: actor.id } });
    const savedCash = await tx.costFlowCash.create({
      data: {
        projectId, requestId, recipientKey, direction, channel, amount: amount.toString(), reference,
        idempotencyKey, commandFingerprint, allocations: json(allocations), evidenceId: savedEvidence.id,
        occurredAt, confirmedBy: actor.id,
        normalizedAllocations: { create: allocations.map(item => ({ projectId, requestId, requestLineId: item.requestLineId, recipientKey, direction, amount: item.amount })) },
      },
    });
    const updated = await tx.costFlowWorkspace.updateMany({ where: { projectId, version: expectedVersion }, data: { version: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("Dữ liệu đã thay đổi. Tải lại để tránh ghi trùng.");
    await tx.costFlowHistory.create({ data: { projectId, version: expectedVersion + 1, actorId: actor.id, action: "CASH", snapshot: json(workspace.data) } });
    return { success: "Đã ghi nhận tiền thực tế và chứng từ.", requestId, cashId: savedCash.id, version: expectedVersion + 1, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

export async function executePaymentCash(projectId: string, expectedVersion: number, actor: Actor, form: FormData, upload: ProjectUpload | null) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await executeOnce(projectId, expectedVersion, actor, form, upload); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new Error("Không thể hoàn tất giao dịch đồng thời.");
}
