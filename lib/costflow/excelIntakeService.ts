import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EXCEL_INTAKE_SCHEMA_VERSION, resolveExcelIntakeDecimalConflicts, type ExcelDecimalResolution } from "./excelIntake";
import type { ExcelIntakePreview } from "./excelIntakeParser";
import { previewRoundTripMerge, applyRoundTripDiff, createRoundTripProjection, resolveRoundTripDecimalConflicts, type RoundTripDiff, type RoundTripImport } from "./excelRoundTrip";
import { emptyFinance, type FinanceData, type PairedRow } from "./types";
import { hydrateLinePricingData, normalizePairedRows } from "./pairedDraft";
import { calculateLineCost, compare, decimal } from "./money";

type Actor = { id: string; role: string };
type AuthorityTx = Prisma.TransactionClient;
type StringMap = Record<string, string>;
type DecimalResolutionMap = Record<string, ExcelDecimalResolution>;

export type ConfirmExcelIntakeCommand = {
  projectId: string;
  previewSessionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  corrections?: StringMap;
  decimalResolutions?: DecimalResolutionMap;
};
export type ConfirmExcelIntakeResult = { draftId: string; version: number; idempotent: boolean };
export type ConfirmRoundTripMergeCommand = {
  projectId: string;
  draftId: string;
  previewSessionId: string;
  idempotencyKey: string;
  selectedDeletionIds: string[];
  decimalResolutions?: DecimalResolutionMap;
};
export type ConfirmRoundTripMergeResult = { draftId: string; draftVersion: number; version: number; idempotent: boolean; rows: PairedRow[] };
export class ExcelIntakeStaleDraftError extends Error {
  readonly code = "STALE_DRAFT";
  constructor() { super("Nháp trên máy chủ đã thay đổi. Tạo lại diff với bản mới nhất trước khi áp dụng."); }
}

export const EXCEL_INTAKE_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type ExcelIntakeOperationKind = "NEW_DRAFT" | "ROUND_TRIP";
export type ExcelIntakePreviewStatus = "ACTIVE" | "SUPERSEDED" | "CANCELLED" | "EXPIRED" | "CONSUMED";

type NewDraftCanonicalPayload = {
  expectedVersion: number;
  preview: ExcelIntakePreview;
  allowedCorrectionKeys: string[];
  allowedDecimalResolutionKeys: string[];
};
type RoundTripCanonicalPayload = {
  expectedWorkspaceVersion: number;
  expectedDraftVersion: number;
  expectedDraftFingerprint: string;
  imported: RoundTripImport;
  diff: RoundTripDiff;
  allowedDecimalResolutionKeys: string[];
};
export type RoundTripPreviewDisplay = {
  draft: { id: string; version: number };
  diff: RoundTripDiff;
};
type ReceiptEnvelope<T> = { output: T; review: unknown };

export type ActionablePreviewSessionView<T> = {
  state: "ACTIONABLE";
  previewSessionId: string;
  operationKind: ExcelIntakeOperationKind;
  expiresAt: string;
  display: T;
};
export type PreviewSessionView = ActionablePreviewSessionView<unknown> | {
  state: "READ_ONLY_CONSUMED";
  previewSessionId: string;
  operationKind: ExcelIntakeOperationKind;
  expiresAt: string;
  display: unknown;
  result: Record<string, unknown> | null;
  source: { filename: string; mimeType: string | null; size: number; sha256: string; downloadUrl: string } | null;
} | {
  state: "NON_ACTIONABLE_EXPIRED" | "NON_ACTIONABLE_SUPERSEDED" | "NON_ACTIONABLE_CANCELLED";
  previewSessionId: string;
  operationKind: ExcelIntakeOperationKind;
  expiresAt: string;
};

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

export type CreateNewDraftPreviewInput = {
  projectId: string;
  preview: ExcelIntakePreview;
  sourceKind: "XLSX" | "PASTE";
  sourceRevision: number;
  sourceFilename?: string | null;
  sourceMimeType?: string | null;
  sourceBytes?: Buffer | null;
  sourceText?: string;
};

export type CreateRoundTripPreviewInput = {
  projectId: string;
  sourceBytes: Buffer;
  sourceFilename: string;
  sourceMimeType?: string | null;
  sourceRevision: number;
  rebaseToCurrent?: boolean;
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonicalValue(nested)]));
  return value;
}
const canonicalHash = (value: unknown) => sha256(JSON.stringify(canonicalValue(value)));
const sortedMap = (value?: StringMap) => Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));

function authorityScopeKey(operationKind: ExcelIntakeOperationKind, draftId?: string | null) {
  if (operationKind === "ROUND_TRIP") {
    if (!draftId) throw new Error("Round-trip preview phải gắn với một nháp.");
    return `ROUND_TRIP:${draftId}`;
  }
  if (draftId) throw new Error("Preview tạo nháp mới không được gắn draftId.");
  return "NEW_DRAFT";
}

async function requireExcelIntakeActor(tx: AuthorityTx, actorId: string, projectId: string) {
  const [project, currentActor] = await Promise.all([
    tx.project.findUnique({ where: { id: projectId }, select: { members: { where: { userId: actorId }, select: { userId: true } } } }),
    tx.user.findFirst({ where: { id: actorId, isActive: true }, select: { role: true } }),
  ]);
  if (!project || !currentActor || !["ADMIN", "ACCOUNT"].includes(currentActor.role) || (currentActor.role !== "ADMIN" && !project.members.length)) {
    throw new Error("Không tìm thấy phiên xem trước hoặc bạn không có quyền.");
  }
  return currentActor;
}

export async function createExcelIntakePreviewSession(tx: AuthorityTx, input: CreateExcelIntakePreviewSessionInput) {
  const now = input.now ?? new Date();
  const scopeKey = authorityScopeKey(input.operationKind, input.draftId);
  await tx.excelIntakePreviewSession.updateMany({
    where: {
      projectId: input.projectId,
      actorId: input.actorId,
      operationKind: input.operationKind,
      scopeKey,
      status: "ACTIVE",
    },
    data: {
      status: "SUPERSEDED",
      supersededAt: now,
      sourceBytes: null,
      canonicalPayload: Prisma.DbNull,
      displayPayload: Prisma.DbNull,
    },
  });
  return tx.excelIntakePreviewSession.create({
    data: {
      projectId: input.projectId,
      actorId: input.actorId,
      operationKind: input.operationKind,
      scopeKey,
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

export async function createNewDraftExcelIntakePreview(actor: Actor, input: CreateNewDraftPreviewInput): Promise<ActionablePreviewSessionView<ExcelIntakePreview>> {
  if (!Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 1) throw new Error("Phiên bản nguồn không hợp lệ.");
  const sourceBytes = input.sourceKind === "XLSX" ? input.sourceBytes : null;
  if (input.sourceKind === "XLSX" && (!sourceBytes?.length || !input.sourceFilename)) throw new Error("Nguồn XLSX không hợp lệ.");
  const sourceSha256 = sourceBytes ? sha256(sourceBytes) : sha256(input.sourceText ?? "");
  return prisma.$transaction(async tx => {
    await requireExcelIntakeActor(tx, actor.id, input.projectId);
    const workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId: input.projectId }, select: { version: true } });
    const payload: NewDraftCanonicalPayload = {
      expectedVersion: workspace?.version ?? 0,
      preview: input.preview,
      allowedCorrectionKeys: input.preview.rows.flatMap(row => [
        "sell.unit", "sell.quantity", "sell.days", "sell.unitPrice", "sell.vatPercent", "sell.basis", "sell.note",
        "buy.unit", "buy.quantity", "buy.days", "buy.unitPrice", "buy.vatPercent", "buy.basis", "buy.note", "buy.supplier",
      ].map(field => `${row.candidateKey}.${field}`)),
      allowedDecimalResolutionKeys: input.preview.decimalConflicts.map(conflict => conflict.conflictId),
    };
    const session = await createExcelIntakePreviewSession(tx, {
      projectId: input.projectId,
      actorId: actor.id,
      operationKind: "NEW_DRAFT",
      sourceKind: input.sourceKind,
      sourceRevision: input.sourceRevision,
      sourceSha256,
      sourceFilename: input.sourceFilename,
      sourceMimeType: input.sourceMimeType,
      sourceBytes,
      canonicalFingerprint: canonicalHash(payload),
      canonicalPayload: payload,
      displayPayload: input.preview,
    });
    return { state: "ACTIONABLE", previewSessionId: session.id, operationKind: "NEW_DRAFT", expiresAt: session.expiresAt.toISOString(), display: input.preview };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

export async function createRoundTripExcelIntakePreview(actor: Actor, input: CreateRoundTripPreviewInput): Promise<ActionablePreviewSessionView<RoundTripPreviewDisplay>> {
  if (!Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 1) throw new Error("Phiên bản nguồn không hợp lệ.");
  const preview = await previewRoundTripMerge(actor, input.projectId, input.sourceBytes, { rebaseToCurrent: input.rebaseToCurrent });
  const payload: RoundTripCanonicalPayload = {
    expectedWorkspaceVersion: preview.workspaceVersion,
    expectedDraftVersion: preview.draft.version,
    expectedDraftFingerprint: preview.imported.fingerprint,
    imported: preview.imported,
    diff: preview.diff,
    allowedDecimalResolutionKeys: preview.diff.decimalConflicts?.map(conflict => conflict.conflictId) ?? [],
  };
  const display: RoundTripPreviewDisplay = { draft: preview.draft, diff: preview.diff };
  return prisma.$transaction(async tx => {
    await requireExcelIntakeActor(tx, actor.id, input.projectId);
    const session = await createExcelIntakePreviewSession(tx, {
      projectId: input.projectId,
      actorId: actor.id,
      operationKind: "ROUND_TRIP",
      draftId: preview.draft.id,
      sourceKind: "XLSX",
      sourceRevision: input.sourceRevision,
      sourceSha256: sha256(input.sourceBytes),
      sourceFilename: input.sourceFilename,
      sourceMimeType: input.sourceMimeType,
      sourceBytes: input.sourceBytes,
      canonicalFingerprint: canonicalHash(payload),
      canonicalPayload: payload,
      displayPayload: display,
    });
    return { state: "ACTIONABLE", previewSessionId: session.id, operationKind: "ROUND_TRIP", expiresAt: session.expiresAt.toISOString(), display };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

export async function rebuildRoundTripExcelIntakePreview(actor: Actor, input: { projectId: string; draftId: string; previewSessionId: string }) {
  const source = await prisma.$transaction(async tx => {
    await requireExcelIntakeActor(tx, actor.id, input.projectId);
    const session = await tx.excelIntakePreviewSession.findFirst({ where: { id: input.previewSessionId, projectId: input.projectId, actorId: actor.id, operationKind: "ROUND_TRIP", draftId: input.draftId, status: "ACTIVE" } });
    if (!session?.sourceBytes || !session.sourceFilename) throw new Error("Workbook nguồn không còn sẵn để tạo lại diff.");
    return { bytes: Buffer.from(session.sourceBytes), filename: session.sourceFilename, mimeType: session.sourceMimeType, sourceRevision: session.sourceRevision + 1 };
  });
  const rebuilt = await createRoundTripExcelIntakePreview(actor, { projectId: input.projectId, sourceBytes: source.bytes, sourceFilename: source.filename, sourceMimeType: source.mimeType, sourceRevision: source.sourceRevision, rebaseToCurrent: true });
  await prisma.$transaction(tx => redactExcelIntakePreviewSession(tx, input.previewSessionId, "SUPERSEDED"));
  return rebuilt;
}

export async function redactExcelIntakePreviewSession(tx: AuthorityTx, sessionId: string, status: Exclude<ExcelIntakePreviewStatus, "ACTIVE" | "CONSUMED">, at = new Date()) {
  const lifecycle = status === "SUPERSEDED" ? { supersededAt: at } : status === "CANCELLED" ? { cancelledAt: at } : {};
  return tx.excelIntakePreviewSession.updateMany({
    where: { id: sessionId, status: "ACTIVE" },
    data: { status, sourceBytes: null, canonicalPayload: Prisma.DbNull, displayPayload: Prisma.DbNull, ...lifecycle },
  });
}

export async function cancelExcelIntakePreviewSession(actor: Actor, projectId: string, sessionId: string): Promise<PreviewSessionView> {
  return prisma.$transaction(async tx => {
    await requireExcelIntakeActor(tx, actor.id, projectId);
    let session = await tx.excelIntakePreviewSession.findFirst({
      where: { id: sessionId, projectId, actorId: actor.id },
      include: { operationReceipt: true, sourceEvidence: true },
    });
    if (!session) throw new Error("Không tìm thấy phiên xem trước hoặc bạn không có quyền.");
    const now = new Date();
    if (session.status === "ACTIVE") {
      await redactExcelIntakePreviewSession(tx, session.id, session.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "CANCELLED", now);
      session = await tx.excelIntakePreviewSession.findFirstOrThrow({
        where: { id: session.id },
        include: { operationReceipt: true, sourceEvidence: true },
      });
    }
    if (session.status === "CONSUMED") {
      const envelope = session.operationReceipt ? receiptEnvelope<Record<string, unknown>>(session.operationReceipt.result) : null;
      const source = session.sourceEvidence ? {
        filename: session.sourceEvidence.filename,
        mimeType: session.sourceEvidence.mimeType,
        size: session.sourceEvidence.size,
        sha256: session.sourceEvidence.sha256,
        downloadUrl: `/api/projects/${projectId}/costflow/excel-intake/sessions/${session.id}/source`,
      } : null;
      return { state: "READ_ONLY_CONSUMED", previewSessionId: session.id, operationKind: session.operationKind as ExcelIntakeOperationKind, expiresAt: session.expiresAt.toISOString(), display: envelope?.review ?? null, result: envelope?.output ?? null, source };
    }
    return {
      state: nonActionableState(session.status) as "NON_ACTIONABLE_EXPIRED" | "NON_ACTIONABLE_SUPERSEDED" | "NON_ACTIONABLE_CANCELLED",
      previewSessionId: session.id,
      operationKind: session.operationKind as ExcelIntakeOperationKind,
      expiresAt: session.expiresAt.toISOString(),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
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
  if (!session.canonicalPayload || !session.displayPayload) throw new Error("Phiên xem trước không còn dữ liệu để áp dụng.");
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

export async function copySuccessfulExcelSourceEvidence(tx: AuthorityTx, input: { sessionId: string; receiptId: string; linkedRecordKind: string; linkedRecordId: string }) {
  const session = await tx.excelIntakePreviewSession.findUniqueOrThrow({ where: { id: input.sessionId } });
  if (session.sourceKind !== "XLSX" || !session.sourceBytes || !session.sourceFilename) throw new Error("Phiên xem trước không có nguồn XLSX để lưu bằng chứng.");
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

export async function consumeExcelIntakePreviewSession(tx: AuthorityTx, input: { sessionId: string; receiptId: string; resultKind: string; resultId: string; consumedAt?: Date }) {
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

function receiptEnvelope<T>(value: Prisma.JsonValue): ReceiptEnvelope<T> {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("output" in value)) throw new Error("Biên nhận thao tác không hợp lệ.");
  return value as unknown as ReceiptEnvelope<T>;
}

function nonActionableState(status: string): PreviewSessionView["state"] {
  if (status === "SUPERSEDED") return "NON_ACTIONABLE_SUPERSEDED";
  if (status === "CANCELLED") return "NON_ACTIONABLE_CANCELLED";
  return "NON_ACTIONABLE_EXPIRED";
}

export async function getExcelIntakePreviewSessionView(actor: Actor, projectId: string, sessionId: string): Promise<PreviewSessionView> {
  return prisma.$transaction(async tx => {
    await requireExcelIntakeActor(tx, actor.id, projectId);
    let session = await tx.excelIntakePreviewSession.findFirst({ where: { id: sessionId, projectId, actorId: actor.id }, include: { operationReceipt: true, sourceEvidence: true } });
    if (!session) throw new Error("Không tìm thấy phiên xem trước hoặc bạn không có quyền.");
    if (session.status === "ACTIVE" && session.expiresAt.getTime() <= Date.now()) {
      await redactExcelIntakePreviewSession(tx, session.id, "EXPIRED");
      session = await tx.excelIntakePreviewSession.findFirstOrThrow({ where: { id: session.id }, include: { operationReceipt: true, sourceEvidence: true } });
    }
    if (session.status === "ACTIVE") {
      if (!session.displayPayload) throw new Error("Phiên xem trước không còn dữ liệu để tiếp tục.");
      return { state: "ACTIONABLE", previewSessionId: session.id, operationKind: session.operationKind as ExcelIntakeOperationKind, expiresAt: session.expiresAt.toISOString(), display: session.displayPayload };
    }
    if (session.status === "CONSUMED") {
      const envelope = session.operationReceipt ? receiptEnvelope<Record<string, unknown>>(session.operationReceipt.result) : null;
      const source = session.sourceEvidence ? {
        filename: session.sourceEvidence.filename,
        mimeType: session.sourceEvidence.mimeType,
        size: session.sourceEvidence.size,
        sha256: session.sourceEvidence.sha256,
        downloadUrl: `/api/projects/${projectId}/costflow/excel-intake/sessions/${session.id}/source`,
      } : null;
      return { state: "READ_ONLY_CONSUMED", previewSessionId: session.id, operationKind: session.operationKind as ExcelIntakeOperationKind, expiresAt: session.expiresAt.toISOString(), display: envelope?.review ?? null, result: envelope?.output ?? null, source };
    }
    return { state: nonActionableState(session.status) as "NON_ACTIONABLE_EXPIRED" | "NON_ACTIONABLE_SUPERSEDED" | "NON_ACTIONABLE_CANCELLED", previewSessionId: session.id, operationKind: session.operationKind as ExcelIntakeOperationKind, expiresAt: session.expiresAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

export async function loadExcelIntakeSourceEvidence(actor: Actor, projectId: string, sessionId: string) {
  await prisma.$transaction(tx => requireExcelIntakeActor(tx, actor.id, projectId));
  const evidence = await prisma.excelIntakeSourceEvidence.findFirst({
    where: { projectId, previewSessionId: sessionId, previewSession: { actorId: actor.id, status: "CONSUMED" } },
  });
  if (!evidence) throw new Error("Không tìm thấy nguồn xác nhận hoặc bạn không có quyền.");
  return evidence;
}

function validateIdempotencyKey(value: string) {
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(value)) throw new Error("Mã chống ghi trùng không hợp lệ.");
}

function validateAllowedMap(input: StringMap | undefined, allowedKeys: string[], label: string) {
  const sorted = sortedMap(input);
  const allowed = new Set(allowedKeys);
  if (Object.keys(sorted).some(key => !allowed.has(key))) throw new Error(`${label} không hợp lệ cho phiên xem trước này.`);
  return sorted;
}

function validatedDecimalResolutions(input: DecimalResolutionMap | undefined, allowedKeys: string[]) {
  const resolutions = validateAllowedMap(input, allowedKeys, "Cách xử lý số thập phân") as DecimalResolutionMap;
  if (Object.keys(resolutions).length !== allowedKeys.length || allowedKeys.some(key => !(key in resolutions))) throw new Error("Cần chọn đầy đủ cách xử lý cho từng ô số thập phân xung đột.");
  if (Object.values(resolutions).some(value => value !== "VISIBLE" && value !== "CANONICAL")) throw new Error("Cách xử lý số thập phân không hợp lệ cho phiên xem trước này.");
  return resolutions;
}

function correctedValue(preview: ExcelIntakePreview, corrections: StringMap, rowKey: string, field: string, fallback: string | null) {
  void preview;
  return String(corrections[`${rowKey}.${field}`] ?? fallback ?? "").trim();
}

function buildRows(preview: ExcelIntakePreview, corrections: StringMap): PairedRow[] {
  const ids = new Map(preview.rows.map(row => [row.candidateKey, randomUUID()]));
  const rows = preview.rows.map(row => ({
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
      unit: correctedValue(preview, corrections, row.candidateKey, "sell.unit", row.sell.unit),
      quantity: correctedValue(preview, corrections, row.candidateKey, "sell.quantity", row.sell.quantity),
      days: correctedValue(preview, corrections, row.candidateKey, "sell.days", row.sell.days),
      unitPrice: correctedValue(preview, corrections, row.candidateKey, "sell.unitPrice", row.sell.unitPrice),
      vatPercent: correctedValue(preview, corrections, row.candidateKey, "sell.vatPercent", row.sell.vatPercent),
      basis: (correctedValue(preview, corrections, row.candidateKey, "sell.basis", row.sell.basis) || "NET") as "NET" | "GROSS",
      notes: correctedValue(preview, corrections, row.candidateKey, "sell.note", row.sell.note),
    },
    buy: {
      unit: correctedValue(preview, corrections, row.candidateKey, "buy.unit", row.buy.unit),
      quantity: correctedValue(preview, corrections, row.candidateKey, "buy.quantity", row.buy.quantity),
      days: correctedValue(preview, corrections, row.candidateKey, "buy.days", row.buy.days),
      unitPrice: correctedValue(preview, corrections, row.candidateKey, "buy.unitPrice", row.buy.unitPrice),
      vatPercent: correctedValue(preview, corrections, row.candidateKey, "buy.vatPercent", row.buy.vatPercent),
      basis: (correctedValue(preview, corrections, row.candidateKey, "buy.basis", row.buy.basis) || "NET") as "NET" | "GROSS",
      notes: correctedValue(preview, corrections, row.candidateKey, "buy.note", row.buy.note),
      vendorId: "",
      evidenceIds: [],
      evidenceReason: correctedValue(preview, corrections, row.candidateKey, "buy.supplier", row.buy.supplier) ? `Nguồn Excel — NCC: ${correctedValue(preview, corrections, row.candidateKey, "buy.supplier", row.buy.supplier)}` : "",
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

function newDraftCommandFingerprint(actorId: string, command: ConfirmExcelIntakeCommand) {
  return canonicalHash({ actorId, projectId: command.projectId, operationKind: "NEW_DRAFT", previewSessionId: command.previewSessionId, expectedVersion: command.expectedVersion, corrections: sortedMap(command.corrections), decimalResolutions: sortedMap(command.decimalResolutions) });
}

function roundTripCommandFingerprint(actorId: string, command: ConfirmRoundTripMergeCommand) {
  return canonicalHash({ actorId, projectId: command.projectId, operationKind: "ROUND_TRIP", draftId: command.draftId, previewSessionId: command.previewSessionId, selectedDeletionIds: [...command.selectedDeletionIds].sort(), decimalResolutions: sortedMap(command.decimalResolutions) });
}

export async function confirmExcelIntake(actor: Actor, command: ConfirmExcelIntakeCommand): Promise<ConfirmExcelIntakeResult> {
  if (!command.projectId || !command.previewSessionId || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) throw new Error("Phiên bản hồ sơ không hợp lệ.");
  validateIdempotencyKey(command.idempotencyKey);
  const operationFingerprint = newDraftCommandFingerprint(actor.id, command);
  return prisma.$transaction(async tx => {
    await requireExcelIntakeActor(tx, actor.id, command.projectId);
    const prior = await readExcelIntakeOperationReceipt(tx, command.projectId, command.idempotencyKey);
    if (prior) {
      if (prior.actorId !== actor.id || prior.operationKind !== "NEW_DRAFT" || prior.previewSessionId !== command.previewSessionId || prior.canonicalFingerprint !== operationFingerprint) throw new Error("Mã chống ghi trùng đã được dùng với dữ liệu khác.");
      return { ...receiptEnvelope<ConfirmExcelIntakeResult>(prior.result).output, idempotent: true };
    }
    const session = await loadActionableExcelIntakePreviewSession(tx, { sessionId: command.previewSessionId, projectId: command.projectId, actorId: actor.id, operationKind: "NEW_DRAFT" });
    const payload = session.canonicalPayload as unknown as NewDraftCanonicalPayload;
    if (canonicalHash(payload) !== session.canonicalFingerprint || payload.preview.schemaVersion !== EXCEL_INTAKE_SCHEMA_VERSION || payload.preview.errors.length) throw new Error("Xem trước còn lỗi cần sửa.");
    if (payload.expectedVersion !== command.expectedVersion) throw new Error("Dữ liệu đã thay đổi. Tải lại trước khi tạo nháp.");
    const corrections = validateAllowedMap(command.corrections, payload.allowedCorrectionKeys, "Ô sửa");
    const decimalResolutions = validatedDecimalResolutions(command.decimalResolutions, payload.allowedDecimalResolutionKeys);
    const conflictCorrectionKeys = new Set(payload.preview.decimalConflicts.map(conflict => `${conflict.candidateKey}.${conflict.field}`));
    if (Object.keys(corrections).some(key => conflictCorrectionKeys.has(key))) throw new Error("Ô có xung đột số thập phân phải dùng lựa chọn theo từng ô, không được ghi đè trực tiếp.");
    let workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId: command.projectId } });
    if (!workspace) workspace = await tx.costFlowWorkspace.create({ data: { projectId: command.projectId, data: json(emptyFinance()) } });
    if (workspace.version !== payload.expectedVersion) throw new Error("Dữ liệu đã thay đổi. Tải lại trước khi tạo nháp.");
    const data = hydrateLinePricingData(workspace.data as unknown as FinanceData);
    const rows = buildRows(resolveExcelIntakeDecimalConflicts(payload.preview, decimalResolutions), corrections);
    const draftId = randomUUID();
    data.quotationDrafts = [...(data.quotationDrafts ?? []), {
      linePricingSchemaVersion: 2,
      id: draftId,
      version: 1,
      createdBy: actor.id,
      workspaceMode: "paired",
      title: payload.preview.metadata.projectName || "Báo giá nhập Excel",
      clientId: "",
      customer: payload.preview.metadata.customer,
      notes: `Nguồn ${payload.preview.source.sheet} ${payload.preview.source.range}`.trim(),
      rows,
      globalEvidenceIds: [],
    }];
    const updated = await tx.costFlowWorkspace.updateMany({ where: { projectId: command.projectId, version: payload.expectedVersion }, data: { data: json(data), version: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("Có thao tác đồng thời. Tải lại rồi thử lại.");
    const output: ConfirmExcelIntakeResult = { draftId, version: payload.expectedVersion + 1, idempotent: false };
    const receipt = await claimExcelIntakeOperationReceipt(tx, { projectId: command.projectId, previewSessionId: session.id, idempotencyKey: command.idempotencyKey, actorId: actor.id, operationKind: "NEW_DRAFT", canonicalFingerprint: operationFingerprint, result: { output, review: session.displayPayload }, linkedRecordKind: "PAIRED_DRAFT", linkedRecordId: draftId });
    if (session.sourceKind === "XLSX") await copySuccessfulExcelSourceEvidence(tx, { sessionId: session.id, receiptId: receipt.id, linkedRecordKind: "PAIRED_DRAFT", linkedRecordId: draftId });
    await tx.costFlowHistory.create({ data: { projectId: command.projectId, version: output.version, actorId: actor.id, action: "CONFIRM_EXCEL_INTAKE", snapshot: json(data) } });
    await consumeExcelIntakePreviewSession(tx, { sessionId: session.id, receiptId: receipt.id, resultKind: "PAIRED_DRAFT", resultId: draftId });
    return output;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

export async function confirmRoundTripMerge(actor: Actor, command: ConfirmRoundTripMergeCommand): Promise<ConfirmRoundTripMergeResult> {
  if (!command.projectId || !command.draftId || !command.previewSessionId) throw new Error("Phiên round-trip không hợp lệ.");
  validateIdempotencyKey(command.idempotencyKey);
  if (!Array.isArray(command.selectedDeletionIds) || command.selectedDeletionIds.some(id => typeof id !== "string")) throw new Error("Danh sách xác nhận xóa không hợp lệ.");
  const selectedDeletionIds = [...command.selectedDeletionIds].sort();
  const operationFingerprint = roundTripCommandFingerprint(actor.id, { ...command, selectedDeletionIds });
  return prisma.$transaction(async tx => {
    await requireExcelIntakeActor(tx, actor.id, command.projectId);
    const prior = await readExcelIntakeOperationReceipt(tx, command.projectId, command.idempotencyKey);
    if (prior) {
      if (prior.actorId !== actor.id || prior.operationKind !== "ROUND_TRIP" || prior.previewSessionId !== command.previewSessionId || prior.canonicalFingerprint !== operationFingerprint || prior.linkedRecordId !== command.draftId) throw new Error("Mã chống ghi trùng đã được dùng với dữ liệu khác.");
      return { ...receiptEnvelope<ConfirmRoundTripMergeResult>(prior.result).output, idempotent: true };
    }
    const session = await loadActionableExcelIntakePreviewSession(tx, { sessionId: command.previewSessionId, projectId: command.projectId, actorId: actor.id, operationKind: "ROUND_TRIP", draftId: command.draftId });
    const payload = session.canonicalPayload as unknown as RoundTripCanonicalPayload;
    if (canonicalHash(payload) !== session.canonicalFingerprint || !payload.diff.previewFingerprint) throw new Error("Xem trước round-trip không còn khớp.");
    const decimalResolutions = validatedDecimalResolutions(command.decimalResolutions, payload.allowedDecimalResolutionKeys);
    const workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId: command.projectId } });
    if (!workspace || workspace.version !== payload.expectedWorkspaceVersion) throw new ExcelIntakeStaleDraftError();
    const data = hydrateLinePricingData(workspace.data as unknown as FinanceData);
    const draft = data.quotationDrafts?.find(value => value.id === command.draftId);
    if (!draft || draft.createdBy !== actor.id || draft.workspaceMode !== "paired" || data.closed) throw new Error("Nháp không còn ở trạng thái được phép chỉnh sửa.");
    if (draft.version !== payload.expectedDraftVersion || createRoundTripProjection(command.projectId, draft).fingerprint !== payload.expectedDraftFingerprint) throw new ExcelIntakeStaleDraftError();
    if (draft.icRevisionId) {
      const revision = data.revisions.find(value => value.id === draft.icRevisionId);
      const request = revision ? await tx.workflowRequest.findUnique({ where: { id: revision.requestId }, select: { state: true, creatorId: true } }) : null;
      if (!revision || revision.effective || request?.state !== "DRAFT" || request.creatorId !== actor.id) throw new Error("IC đã gửi hoặc có hiệu lực phải đi qua lifecycle revision hiện có.");
    }
    draft.rows = applyRoundTripDiff(draft, resolveRoundTripDecimalConflicts(payload.diff, decimalResolutions), selectedDeletionIds);
    draft.version += 1;
    const updated = await tx.costFlowWorkspace.updateMany({ where: { projectId: command.projectId, version: payload.expectedWorkspaceVersion }, data: { data: json(data), version: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("Có thao tác đồng thời. Tải lại và xuất workbook mới trước khi thử lại.");
    const output: ConfirmRoundTripMergeResult = { draftId: draft.id, draftVersion: draft.version, version: payload.expectedWorkspaceVersion + 1, idempotent: false, rows: structuredClone(draft.rows) };
    const receipt = await claimExcelIntakeOperationReceipt(tx, { projectId: command.projectId, previewSessionId: session.id, idempotencyKey: command.idempotencyKey, actorId: actor.id, operationKind: "ROUND_TRIP", canonicalFingerprint: operationFingerprint, result: { output, review: session.displayPayload }, linkedRecordKind: "PAIRED_DRAFT", linkedRecordId: draft.id });
    await copySuccessfulExcelSourceEvidence(tx, { sessionId: session.id, receiptId: receipt.id, linkedRecordKind: "PAIRED_DRAFT", linkedRecordId: draft.id });
    await tx.costFlowHistory.create({ data: { projectId: command.projectId, version: output.version, actorId: actor.id, action: "CONFIRM_EXCEL_ROUND_TRIP", snapshot: json(data) } });
    await consumeExcelIntakePreviewSession(tx, { sessionId: session.id, receiptId: receipt.id, resultKind: "PAIRED_DRAFT", resultId: draft.id });
    return output;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}
