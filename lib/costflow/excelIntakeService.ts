import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EXCEL_INTAKE_SCHEMA_VERSION } from "./excelIntake";
import type { ExcelIntakePreview } from "./excelIntakeParser";
import { emptyFinance, type FinanceData, type PairedRow } from "./types";
import { hydrateLinePricingData, normalizePairedRows } from "./pairedDraft";
import { calculateLineCost, compare, decimal } from "./money";
import { applyRoundTripDiff, createRoundTripProjection, diffRoundTripDraft, type RoundTripImport } from "./excelRoundTrip";

type Actor = { id: string; role: string };
export type ConfirmExcelIntakeCommand = { projectId: string; expectedVersion: number; idempotencyKey: string; fingerprint: string; preview: ExcelIntakePreview; corrections?: Record<string, string> };
export type ConfirmExcelIntakeResult = { draftId: string; version: number; idempotent: boolean };
export type ConfirmRoundTripMergeCommand = { projectId: string; draftId: string; expectedWorkspaceVersion: number; expectedDraftVersion: number; expectedDraftFingerprint: string; previewFingerprint: string; imported: RoundTripImport; selectedDeletionIds: string[]; idempotencyKey: string };
export type ConfirmRoundTripMergeResult = { draftId: string; draftVersion: number; version: number; idempotent: boolean; rows: PairedRow[] };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const EXCEL_INTAKE_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ExcelIntakeOperationKind = "NEW_DRAFT" | "ROUND_TRIP";
export type ExcelIntakePreviewStatus = "ACTIVE" | "SUPERSEDED" | "CANCELLED" | "EXPIRED" | "CONSUMED";
type AuthorityTx = Prisma.TransactionClient;

export type CreateExcelIntakePreviewSessionInput = {
  projectId: string;
  actorId: string;
  operationKind: ExcelIntakeOperationKind;
  draftId?: string | null;
  sourceKind: "XLSX" | "PASTE";
  sourceRevision: number;
  sourceSha256: string;
  sourceFilename?: string | null;
  sourceMimeType?: string | null;
  sourceBytes?: Buffer | null;
  canonicalFingerprint: string;
  canonicalPayload: unknown;
  displayPayload: unknown;
  now?: Date;
};

function authorityScopeKey(operationKind: ExcelIntakeOperationKind, draftId?: string | null) {
  if (operationKind === "ROUND_TRIP") {
    if (!draftId) throw new Error("Round-trip preview phải gắn với một nháp.");
    return `ROUND_TRIP:${draftId}`;
  }
  if (draftId) throw new Error("Preview tạo nháp mới không được gắn draftId.");
  return "NEW_DRAFT";
}

export async function createExcelIntakePreviewSession(tx: AuthorityTx, input: CreateExcelIntakePreviewSessionInput) {
  const now = input.now ?? new Date();
  return tx.excelIntakePreviewSession.create({
    data: {
      projectId: input.projectId,
      actorId: input.actorId,
      operationKind: input.operationKind,
      scopeKey: authorityScopeKey(input.operationKind, input.draftId),
      draftId: input.draftId ?? null,
      sourceKind: input.sourceKind,
      sourceRevision: input.sourceRevision,
      sourceSha256: input.sourceSha256,
      sourceFilename: input.sourceFilename ?? null,
      sourceMimeType: input.sourceMimeType ?? null,
      sourceSize: input.sourceBytes?.byteLength ?? 0,
      sourceBytes: input.sourceBytes ? new Uint8Array(input.sourceBytes) : null,
      canonicalFingerprint: input.canonicalFingerprint,
      canonicalPayload: json(input.canonicalPayload),
      displayPayload: json(input.displayPayload),
      status: "ACTIVE",
      expiresAt: new Date(now.getTime() + EXCEL_INTAKE_PREVIEW_TTL_MS),
      createdAt: now,
    },
  });
}

export async function redactExcelIntakePreviewSession(
  tx: AuthorityTx,
  sessionId: string,
  status: Exclude<ExcelIntakePreviewStatus, "ACTIVE" | "CONSUMED">,
  at = new Date(),
) {
  const lifecycle = status === "SUPERSEDED"
    ? { supersededAt: at }
    : status === "CANCELLED"
      ? { cancelledAt: at }
      : {};
  return tx.excelIntakePreviewSession.updateMany({
    where: { id: sessionId, status: "ACTIVE" },
    data: {
      status,
      sourceBytes: null,
      canonicalPayload: Prisma.DbNull,
      displayPayload: Prisma.DbNull,
      ...lifecycle,
    },
  });
}

export async function loadActionableExcelIntakePreviewSession(tx: AuthorityTx, input: {
  sessionId: string;
  projectId: string;
  actorId: string;
  operationKind: ExcelIntakeOperationKind;
  draftId?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const session = await tx.excelIntakePreviewSession.findFirst({ where: {
    id: input.sessionId,
    projectId: input.projectId,
    actorId: input.actorId,
    operationKind: input.operationKind,
    scopeKey: authorityScopeKey(input.operationKind, input.draftId),
  } });
  if (!session) throw new Error("Không tìm thấy phiên xem trước hoặc bạn không có quyền.");
  if (session.status !== "ACTIVE") throw new Error("Phiên xem trước không còn hiệu lực.");
  if (session.expiresAt.getTime() <= now.getTime()) {
    await redactExcelIntakePreviewSession(tx, session.id, "EXPIRED", now);
    throw new Error("Phiên xem trước đã hết hạn sau 7 ngày.");
  }
  return session;
}

export async function readExcelIntakeOperationReceipt(tx: AuthorityTx, projectId: string, idempotencyKey: string) {
  return tx.excelIntakeOperationReceipt.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey } } });
}

export async function claimExcelIntakeOperationReceipt(tx: AuthorityTx, input: {
  projectId: string;
  previewSessionId: string;
  idempotencyKey: string;
  actorId: string;
  operationKind: ExcelIntakeOperationKind;
  canonicalFingerprint: string;
  result: unknown;
  linkedRecordKind: string;
  linkedRecordId: string;
}) {
  return tx.excelIntakeOperationReceipt.create({ data: {
    projectId: input.projectId,
    previewSessionId: input.previewSessionId,
    idempotencyKey: input.idempotencyKey,
    actorId: input.actorId,
    operationKind: input.operationKind,
    canonicalFingerprint: input.canonicalFingerprint,
    result: json(input.result),
    linkedRecordKind: input.linkedRecordKind,
    linkedRecordId: input.linkedRecordId,
  } });
}

export async function copySuccessfulExcelSourceEvidence(tx: AuthorityTx, input: {
  sessionId: string;
  receiptId: string;
  linkedRecordKind: string;
  linkedRecordId: string;
}) {
  const session = await tx.excelIntakePreviewSession.findUniqueOrThrow({ where: { id: input.sessionId } });
  if (session.sourceKind !== "XLSX" || !session.sourceBytes || !session.sourceFilename) {
    throw new Error("Phiên xem trước không có nguồn XLSX để lưu bằng chứng.");
  }
  return tx.excelIntakeSourceEvidence.create({ data: {
    projectId: session.projectId,
    previewSessionId: session.id,
    receiptId: input.receiptId,
    actorId: session.actorId,
    operationKind: session.operationKind,
    filename: session.sourceFilename,
    mimeType: session.sourceMimeType,
    size: session.sourceSize,
    sha256: session.sourceSha256,
    data: session.sourceBytes,
    linkedRecordKind: input.linkedRecordKind,
    linkedRecordId: input.linkedRecordId,
  } });
}

export async function consumeExcelIntakePreviewSession(tx: AuthorityTx, input: {
  sessionId: string;
  receiptId: string;
  resultKind: string;
  resultId: string;
  consumedAt?: Date;
}) {
  const consumedAt = input.consumedAt ?? new Date();
  const updated = await tx.excelIntakePreviewSession.updateMany({
    where: { id: input.sessionId, status: "ACTIVE", expiresAt: { gt: consumedAt } },
    data: {
      status: "CONSUMED",
      receiptId: input.receiptId,
      resultKind: input.resultKind,
      resultId: input.resultId,
      consumedAt,
      sourceBytes: null,
      canonicalPayload: Prisma.DbNull,
      displayPayload: Prisma.DbNull,
    },
  });
  if (updated.count !== 1) throw new Error("Phiên xem trước đã được dùng hoặc không còn hiệu lực.");
}

export async function loadExcelIntakeReadOnlyReview(input: { sessionId: string; projectId: string; actorId: string }) {
  return prisma.excelIntakePreviewSession.findFirst({
    where: { id: input.sessionId, projectId: input.projectId, actorId: input.actorId, status: "CONSUMED" },
    include: { operationReceipt: true, sourceEvidence: true },
  });
}

function previewFingerprint(preview: ExcelIntakePreview) {
  const normalized = { ...preview } as Partial<ExcelIntakePreview>;
  delete normalized.fingerprint;
  delete normalized.adapter;
  delete normalized.confidence;
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function correctedValue(command: ConfirmExcelIntakeCommand, rowKey: string, field: string, fallback: string | null) {
  return String(command.corrections?.[`${rowKey}.${field}`] ?? fallback ?? "").trim();
}

function buildRows(command: ConfirmExcelIntakeCommand): PairedRow[] {
  const ids = new Map(command.preview.rows.map(row => [row.candidateKey, randomUUID()]));
  const rows = command.preview.rows.map(row => ({
    itemId: ids.get(row.candidateKey)!,
    parentItemId: row.parentCandidateKey ? ids.get(row.parentCandidateKey) ?? null : null,
    rowType: row.rowType,
    name: row.name,
    description: row.description,
    pricingMode: "DETAIL" as const,
    showChildren: true,
    showGroupSubtotal: true,
    packageChildDisplay: "CONTENT" as const,
    sell: {
      unit: correctedValue(command, row.candidateKey, "sell.unit", row.sell.unit),
      quantity: correctedValue(command, row.candidateKey, "sell.quantity", row.sell.quantity),
      days: correctedValue(command, row.candidateKey, "sell.days", row.sell.days),
      unitPrice: correctedValue(command, row.candidateKey, "sell.unitPrice", row.sell.unitPrice),
      vatPercent: correctedValue(command, row.candidateKey, "sell.vatPercent", row.sell.vatPercent),
      basis: (correctedValue(command, row.candidateKey, "sell.basis", row.sell.basis) || "NET") as "NET" | "GROSS",
      notes: correctedValue(command, row.candidateKey, "sell.note", row.sell.note),
    },
    buy: {
      unit: correctedValue(command, row.candidateKey, "buy.unit", row.buy.unit),
      quantity: correctedValue(command, row.candidateKey, "buy.quantity", row.buy.quantity),
      days: correctedValue(command, row.candidateKey, "buy.days", row.buy.days),
      unitPrice: correctedValue(command, row.candidateKey, "buy.unitPrice", row.buy.unitPrice),
      vatPercent: correctedValue(command, row.candidateKey, "buy.vatPercent", row.buy.vatPercent),
      basis: (correctedValue(command, row.candidateKey, "buy.basis", row.buy.basis) || "NET") as "NET" | "GROSS",
      notes: correctedValue(command, row.candidateKey, "buy.note", row.buy.note),
      vendorId: "",
      evidenceIds: [],
      evidenceReason: correctedValue(command, row.candidateKey, "buy.supplier", row.buy.supplier) ? `Nguồn Excel — NCC: ${correctedValue(command, row.candidateKey, "buy.supplier", row.buy.supplier)}` : "",
    },
  }));
  const normalized = normalizePairedRows(rows);
  for (const row of normalized) {
    if (row.rowType === "GROUP") continue;
    for (const side of [row.sell, row.buy]) {
      if (side.quantity && compare(decimal(side.quantity), decimal("0")) <= 0) throw new Error("Số lượng phải lớn hơn 0.");
      if (side.days && compare(decimal(side.days), decimal("0")) <= 0) throw new Error("Số ngày phải lớn hơn 0.");
      if (side.vatPercent && compare(decimal(side.vatPercent), decimal("100")) > 0) throw new Error("VAT phải từ 0 đến 100.");
      if (side.unitPrice === "0" && !side.notes.trim()) throw new Error("Dòng FOC có đơn giá 0 phải kèm ghi chú.");
      if (side.quantity && side.days && side.unitPrice && side.vatPercent) calculateLineCost(side);
    }
  }
  return normalized;
}

export async function confirmExcelIntake(actor: Actor, command: ConfirmExcelIntakeCommand): Promise<ConfirmExcelIntakeResult> {
  if (!command.projectId || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) throw new Error("Phiên bản hồ sơ không hợp lệ.");
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(command.idempotencyKey)) throw new Error("Mã chống ghi trùng không hợp lệ.");
  if (command.preview.schemaVersion !== EXCEL_INTAKE_SCHEMA_VERSION || command.preview.errors.length) throw new Error("Xem trước còn lỗi cần sửa.");
  const calculatedFingerprint = previewFingerprint(command.preview);
  if (calculatedFingerprint !== command.fingerprint || calculatedFingerprint !== command.preview.fingerprint) throw new Error("Xem trước đã thay đổi. Hãy kiểm tra lại trước khi tạo nháp.");
  const corrections = Object.fromEntries(Object.entries(command.corrections ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const operationFingerprint = createHash("sha256").update(JSON.stringify({ preview: calculatedFingerprint, corrections })).digest("hex");

  return prisma.$transaction(async tx => {
    const [project, currentActor] = await Promise.all([
      tx.project.findUnique({ where: { id: command.projectId }, select: { members: { where: { userId: actor.id }, select: { userId: true } } } }),
      tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { role: true } }),
    ]);
    if (!project || !currentActor || !["ADMIN", "ACCOUNT"].includes(currentActor.role) || (currentActor.role !== "ADMIN" && !project.members.length)) throw new Error("Bạn không có quyền tạo nháp cho Project này.");
    let workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId: command.projectId } });
    if (!workspace) workspace = await tx.costFlowWorkspace.create({ data: { projectId: command.projectId, data: json(emptyFinance()) } });
    const data = hydrateLinePricingData(workspace.data as unknown as FinanceData);
    const prior = data.excelIntakeReceipts?.find(receipt => receipt.idempotencyKey === command.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== operationFingerprint || prior.actorId !== actor.id) throw new Error("Mã chống ghi trùng đã được dùng với dữ liệu khác.");
      return { draftId: prior.draftId, version: workspace.version, idempotent: true };
    }
    if (workspace.version !== command.expectedVersion) throw new Error("Dữ liệu đã thay đổi. Tải lại trước khi tạo nháp.");
    const rows = buildRows(command);
    const draftId = randomUUID();
    data.quotationDrafts = [...(data.quotationDrafts ?? []), { linePricingSchemaVersion: 2, id: draftId, version: 1, createdBy: actor.id, workspaceMode: "paired", title: command.preview.metadata.projectName || "Báo giá nhập Excel", clientId: "", customer: command.preview.metadata.customer, notes: `Nguồn ${command.preview.source.sheet} ${command.preview.source.range}`.trim(), rows, globalEvidenceIds: [] }];
    data.excelIntakeReceipts = [...(data.excelIntakeReceipts ?? []).slice(-99), { idempotencyKey: command.idempotencyKey, fingerprint: operationFingerprint, draftId, actorId: actor.id, createdAt: new Date().toISOString() }];
    const updated = await tx.costFlowWorkspace.updateMany({ where: { projectId: command.projectId, version: command.expectedVersion }, data: { data: json(data), version: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("Có thao tác đồng thời. Tải lại rồi thử lại.");
    await tx.costFlowHistory.create({ data: { projectId: command.projectId, version: command.expectedVersion + 1, actorId: actor.id, action: "CONFIRM_EXCEL_INTAKE", snapshot: json(data) } });
    return { draftId, version: command.expectedVersion + 1, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

export async function confirmRoundTripMerge(actor: Actor, command: ConfirmRoundTripMergeCommand): Promise<ConfirmRoundTripMergeResult> {
  if (!command.projectId || !command.draftId || !Number.isSafeInteger(command.expectedWorkspaceVersion) || !Number.isSafeInteger(command.expectedDraftVersion)) throw new Error("Phiên bản round-trip không hợp lệ.");
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(command.idempotencyKey)) throw new Error("Mã chống ghi trùng không hợp lệ.");
  if (!Array.isArray(command.selectedDeletionIds) || command.selectedDeletionIds.some(id => typeof id !== "string")) throw new Error("Danh sách xác nhận xóa không hợp lệ.");
  const selectedDeletionIds = [...command.selectedDeletionIds].sort();
  const operationFingerprint = createHash("sha256").update(JSON.stringify({ draftId: command.draftId, expectedDraftVersion: command.expectedDraftVersion, expectedDraftFingerprint: command.expectedDraftFingerprint, previewFingerprint: command.previewFingerprint, imported: command.imported, selectedDeletionIds })).digest("hex");

  return prisma.$transaction(async tx => {
    const [project, currentActor, workspace] = await Promise.all([
      tx.project.findUnique({ where: { id: command.projectId }, select: { members: { where: { userId: actor.id }, select: { userId: true } } } }),
      tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { role: true } }),
      tx.costFlowWorkspace.findUnique({ where: { projectId: command.projectId } }),
    ]);
    if (!project || !currentActor || !workspace || !["ADMIN", "ACCOUNT"].includes(currentActor.role) || (currentActor.role !== "ADMIN" && !project.members.length)) throw new Error("Không tìm thấy nháp hoặc bạn không có quyền.");
    const data = hydrateLinePricingData(workspace.data as unknown as FinanceData);
    const prior = data.excelIntakeReceipts?.find(receipt => receipt.idempotencyKey === command.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== operationFingerprint || prior.actorId !== actor.id || prior.draftId !== command.draftId) throw new Error("Mã chống ghi trùng đã được dùng với dữ liệu khác.");
      const replayDraft = data.quotationDrafts?.find(value => value.id === prior.draftId);
      if (!replayDraft) throw new Error("Nháp round-trip không còn tồn tại.");
      return { draftId: replayDraft.id, draftVersion: replayDraft.version, version: workspace.version, idempotent: true, rows: structuredClone(replayDraft.rows) };
    }
    if (workspace.version !== command.expectedWorkspaceVersion) throw new Error("Nháp trên máy chủ đã thay đổi. Tải lại và xuất workbook mới trước khi thử lại.");
    const draft = data.quotationDrafts?.find(value => value.id === command.draftId);
    if (!draft || draft.createdBy !== actor.id || draft.workspaceMode !== "paired" || data.closed) throw new Error("Nháp không còn ở trạng thái được phép chỉnh sửa.");
    if (draft.version !== command.expectedDraftVersion || createRoundTripProjection(command.projectId, draft).fingerprint !== command.expectedDraftFingerprint) throw new Error("Nháp trên máy chủ đã thay đổi. Tải lại và xuất workbook mới trước khi thử lại.");
    if (draft.icRevisionId) {
      const revision = data.revisions.find(value => value.id === draft.icRevisionId);
      const request = revision ? await tx.workflowRequest.findUnique({ where: { id: revision.requestId }, select: { state: true, creatorId: true } }) : null;
      if (!revision || revision.effective || request?.state !== "DRAFT" || request.creatorId !== actor.id) throw new Error("IC đã gửi hoặc có hiệu lực phải đi qua lifecycle revision hiện có.");
    }
    const diff = diffRoundTripDraft(draft, command.imported, command.projectId);
    if (diff.previewFingerprint !== command.previewFingerprint) throw new Error("Xem trước round-trip không còn khớp. Hãy xem lại diff trước khi áp dụng.");
    draft.rows = applyRoundTripDiff(draft, diff, selectedDeletionIds);
    draft.version += 1;
    data.excelIntakeReceipts = [...(data.excelIntakeReceipts ?? []).slice(-99), { idempotencyKey: command.idempotencyKey, fingerprint: operationFingerprint, draftId: draft.id, actorId: actor.id, createdAt: new Date().toISOString() }];
    const updated = await tx.costFlowWorkspace.updateMany({ where: { projectId: command.projectId, version: command.expectedWorkspaceVersion }, data: { data: json(data), version: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("Có thao tác đồng thời. Tải lại và xuất workbook mới trước khi thử lại.");
    await tx.costFlowHistory.create({ data: { projectId: command.projectId, version: command.expectedWorkspaceVersion + 1, actorId: actor.id, action: "CONFIRM_EXCEL_ROUND_TRIP", snapshot: json(data) } });
    return { draftId: draft.id, draftVersion: draft.version, version: command.expectedWorkspaceVersion + 1, idempotent: false, rows: structuredClone(draft.rows) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}
