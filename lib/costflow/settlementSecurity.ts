import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  SETTLEMENT_EXPORT_FAMILIES,
  normalizeSettlementExportProjection,
  type SettlementExportFamily,
  type SettlementExportProjection,
} from "./export";

export const SETTLEMENT_PRINT_FAMILIES = SETTLEMENT_EXPORT_FAMILIES;

const PRINT_SIGNATURE_ROLES = ["CREATOR", "MANAGER", "ACCOUNTANT", "CEO"] as const;
const OPAQUE_CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type SettlementPrintSigningEvent = {
  role: string;
  actorId: string;
  actorName: string;
  signedAt: string;
  imageSha256: string;
  eventHash: string;
  signatureDataUrl: string;
  confirmed: boolean;
};

export type SettlementPrintSignatureSlot = {
  role: typeof PRINT_SIGNATURE_ROLES[number];
  state: "SIGNED" | "UNSIGNED";
  actorName?: string;
  signedAt?: string;
  imageSha256?: string;
  eventHash?: string;
  signatureDataUrl?: string;
};

export type SettlementPrintDocument = {
  family: SettlementExportFamily;
  projectName: string;
  title: string;
  sourceVersionId: string;
  sourceVersion: number;
  documentVersion: number;
  approvalState: "APPROVED";
  signingState: "UNSIGNED" | "PARTIALLY_SIGNED" | "SIGNED_CONFIRMED";
  replacementLabel: string;
  approvedAt: string;
  totals: SettlementExportProjection["totals"];
  approvedGross: string;
  moneyInWords: string;
  recipients: SettlementExportProjection["recipients"];
  items: SettlementExportProjection["items"];
  signatureSlots: SettlementPrintSignatureSlot[];
  canonicalHash: string;
  signingSnapshotId: string;
  signingSnapshotState: string;
  verificationPath?: string;
};

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  throw new Error("Dữ liệu canonical không hợp lệ.");
}

function sorted<T>(values: readonly T[], key: (value: T) => string) {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

export function canonicalSettlementProjection(input: SettlementExportProjection) {
  const projection = {
    schema: "costflow.settlement-export.v1",
    projectId: input.projectId,
    family: input.family,
    source: {
      dossierId: input.source.dossierId,
      dossierVersionId: input.source.dossierVersionId,
      dossierVersion: input.source.dossierVersion,
      documentVersionId: input.source.documentVersionId,
      documentVersion: input.source.documentVersion,
      state: input.source.state,
      supersedesId: input.source.supersedesId ?? null,
      replacedById: input.source.replacedById ?? null,
      replacementReason: input.source.replacementReason ?? null,
    },
    totals: input.totals,
    recipients: sorted(input.recipients, row => row.recipientKey),
    items: sorted(input.items, row => `${row.stableLineId}\u0000${row.recipientKey}`),
    obligations: sorted(input.obligations, row => `${row.recipientKey}\u0000${row.direction}`),
    evidence: sorted(input.evidence, row => `${row.id}\u0000${row.kind}\u0000${row.sha256}`),
    signingSnapshot: {
      id: input.signingSnapshot.id,
      state: input.signingSnapshot.state,
      projectionSha256: input.signingSnapshot.projectionSha256,
      events: sorted(input.signingSnapshot.events, event => `${event.signedAt}\u0000${event.role}\u0000${event.eventHash}`),
    },
  };
  return canonicalize(projection);
}

export function settlementProjectionHash(input: SettlementExportProjection) {
  return createHash("sha256").update(JSON.stringify(canonicalSettlementProjection(input))).digest("hex");
}

export function settlementFileHash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertOpaquePublicVerificationToken(value: string) {
  const token = String(value ?? "").trim();
  if (!OPAQUE_CAPABILITY_TOKEN.test(token)) {
    throw new Error("Public verification capability token phải là opaque token 256-bit.");
  }
  return token;
}

function replacementLabel(source: SettlementExportProjection["source"]) {
  if (source.replacedById) return "Phiên bản lịch sử — đã được thay thế";
  if (source.supersedesId) return "Phiên bản thay thế";
  return "Phiên bản gốc";
}

function confirmedSignatureSlots(
  projection: SettlementExportProjection,
  signingEvents: readonly SettlementPrintSigningEvent[],
) {
  const projectionEvents = new Map(projection.signingSnapshot.events.map(event => [event.role, event]));
  const confirmed = new Map(signingEvents.filter(event => {
    const expected = projectionEvents.get(event.role);
    return event.confirmed && Boolean(expected) &&
      expected?.actorId === event.actorId &&
      expected.eventHash === event.eventHash &&
      expected.signedAt === event.signedAt &&
      /^[a-f0-9]{64}$/i.test(event.imageSha256) &&
      event.signatureDataUrl.startsWith("data:image/png;base64,");
  }).map(event => [event.role, event]));

  return PRINT_SIGNATURE_ROLES.map(role => {
    const event = confirmed.get(role);
    if (!event) return { role, state: "UNSIGNED" as const };
    return {
      role,
      state: "SIGNED" as const,
      actorName: event.actorName,
      signedAt: event.signedAt,
      imageSha256: event.imageSha256,
      eventHash: event.eventHash,
      signatureDataUrl: event.signatureDataUrl,
    };
  });
}

function evidenceConfirmed(state: string) {
  return state === "DIGITAL_CONFIRMED" || state === "PHYSICAL_CONFIRMED";
}

export function buildSettlementPrintDocument(input: {
  projection: SettlementExportProjection;
  signingEvents: readonly SettlementPrintSigningEvent[];
  publicVerificationToken?: string;
}): SettlementPrintDocument {
  const normalized = normalizeSettlementExportProjection(input.projection);
  const signatureSlots = confirmedSignatureSlots(normalized, input.signingEvents);
  const signedCount = signatureSlots.filter(slot => slot.state === "SIGNED").length;
  const confirmed = evidenceConfirmed(normalized.signingSnapshot.state);
  const signingState = confirmed
    ? "SIGNED_CONFIRMED"
    : signedCount > 0
      ? "PARTIALLY_SIGNED"
      : "UNSIGNED";
  const token = confirmed && input.publicVerificationToken
    ? assertOpaquePublicVerificationToken(input.publicVerificationToken)
    : undefined;

  return {
    family: normalized.family,
    projectName: normalized.projectName ?? "",
    title: normalized.title ?? normalized.family,
    sourceVersionId: normalized.source.dossierVersionId,
    sourceVersion: normalized.source.dossierVersion,
    documentVersion: normalized.source.documentVersion,
    approvalState: "APPROVED",
    signingState,
    replacementLabel: replacementLabel(normalized.source),
    approvedAt: normalized.approvedAt ?? "",
    totals: normalized.totals,
    approvedGross: normalized.approvedGross,
    moneyInWords: normalized.moneyInWords,
    recipients: normalized.recipients,
    items: normalized.items,
    signatureSlots,
    canonicalHash: settlementProjectionHash(normalized),
    signingSnapshotId: normalized.signingSnapshot.id,
    signingSnapshotState: normalized.signingSnapshot.state,
    verificationPath: token ? `/workflow/verify/${encodeURIComponent(token)}` : undefined,
  };
}

export function settlementPdfAuditIdentity(input: SettlementExportProjection) {
  return {
    family: input.family,
    format: "PDF" as const,
    dossierVersionId: input.source.dossierVersionId,
    approvedSnapshotId: input.signingSnapshot.id,
    canonicalHash: settlementProjectionHash(input),
    signatureState: input.signingSnapshot.state,
  };
}

export function validateSettlementExportAccess(input: {
  actorId: string;
  actorRole: string;
  membershipProjectId: string | null;
  routeProjectId: string;
  sourceProjectId: string;
  requestedVersionId: string;
  sourceVersionId: string;
  sourceState: string;
}) {
  if (!input.actorId) throw new Error("Người xuất không hợp lệ.");
  if (input.actorRole !== "ADMIN" && input.membershipProjectId !== input.routeProjectId) {
    throw new Error("Bạn không có quyền thành viên để xuất hồ sơ Project này.");
  }
  if (input.routeProjectId !== input.sourceProjectId) throw new Error("Phiên bản xuất không thuộc Project trên route.");
  if (input.requestedVersionId !== input.sourceVersionId) throw new Error("Phiên bản xuất không khớp nguồn bất biến.");
  if (input.sourceState !== "APPROVED") throw new Error("Chỉ xuất từ nguồn đã duyệt và immutable.");
}

type SealedSourceRow = {
  id: string;
  projectId: string;
  dossierVersionId: string | null;
  family: string;
  sourceKind: string;
  sourceId: string;
  sourceVersion: number;
  projectionHash: string;
  approvalAttemptId: string | null;
  approvedSnapshotId: string | null;
  signingState: string | null;
};

function sameToken(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function reserveSettlementExportArtifact(tx: Prisma.TransactionClient, input: {
  sourceProjection: SealedSourceRow;
  format: "PDF" | "XLSX";
  createdById: string;
}) {
  const source = input.sourceProjection;
  if (!source.approvalAttemptId || !source.signingState) throw new Error("Source projection thiếu attempt/signing identity.");
  const idempotencyKey = ["SEALED_EXPORT_V2", input.format, source.family, source.sourceKind, source.sourceId, source.sourceVersion, source.approvalAttemptId, source.approvedSnapshotId ?? "UNSIGNED", source.projectionHash].join(":");
  const token = randomBytes(32).toString("base64url");
  let audit = await tx.settlementExportAudit.upsert({
    where: { projectId_idempotencyKey: { projectId: source.projectId, idempotencyKey } },
    create: {
      project: { connect: { id: source.projectId } },
      ...(source.dossierVersionId ? { dossierVersion: { connect: { id: source.dossierVersionId } } } : {}),
      sourceProjection: { connect: { id_projectId: { id: source.id, projectId: source.projectId } } },
      ...(source.approvedSnapshotId ? { approvedSnapshot: { connect: { id: source.approvedSnapshotId } } } : {}),
      createdBy: { connect: { id: input.createdById } },
      family: source.family,
      format: input.format,
      canonicalHash: source.projectionHash,
      approvalAttemptId: source.approvalAttemptId,
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      sourceVersion: source.sourceVersion,
      artifactStatus: "RESERVED",
      reservationToken: token,
      idempotencyKey,
    },
    update: {},
  });
  const identical = audit.sourceProjectionId === source.id && audit.canonicalHash === source.projectionHash
    && audit.approvalAttemptId === source.approvalAttemptId && audit.approvedSnapshotId === source.approvedSnapshotId
    && audit.sourceKind === source.sourceKind && audit.sourceId === source.sourceId && audit.sourceVersion === source.sourceVersion
    && audit.family === source.family && audit.format === input.format && !!audit.reservationToken;
  if (!identical) throw new Error("Export reservation xung đột exact source identity.");
  if (audit.artifactStatus === "FAILED") {
    const retryToken = randomBytes(32).toString("base64url");
    const retried = await tx.settlementExportAudit.updateMany({
      where: { id: audit.id, artifactStatus: "FAILED", canonicalHash: source.projectionHash },
      data: { artifactStatus: "RESERVED", reservationToken: retryToken },
    });
    if (retried.count !== 1) throw new Error("Export reservation retry đã thay đổi trước khi reserve lại.");
    audit = await tx.settlementExportAudit.findUniqueOrThrow({ where: { id: audit.id } });
  }
  return { audit, reservationToken: audit.reservationToken! };
}

export async function finalizeSettlementExportArtifact(tx: Prisma.TransactionClient, input: {
  auditId: string;
  reservationToken: string;
  bytes: Uint8Array;
}) {
  const audit = await tx.settlementExportAudit.findUnique({ where: { id: input.auditId } });
  if (!audit?.reservationToken || !sameToken(audit.reservationToken, input.reservationToken)) throw new Error("Export reservation token không hợp lệ.");
  const bytes = Buffer.from(input.bytes);
  if (!bytes.length) throw new Error("Artifact bytes không được rỗng.");
  const fileSha256 = settlementFileHash(bytes);
  if (audit.artifactStatus === "FINALIZED") {
    if (!audit.artifactBytes || audit.artifactByteLength !== bytes.length || audit.fileSha256 !== fileSha256 || !Buffer.from(audit.artifactBytes).equals(bytes)) {
      throw new Error("Finalized export bytes/hash conflict.");
    }
    return audit;
  }
  if (audit.artifactStatus !== "RESERVED") throw new Error("Export reservation không còn ở trạng thái RESERVED.");
  const updated = await tx.settlementExportAudit.updateMany({
    where: { id: audit.id, artifactStatus: "RESERVED", reservationToken: input.reservationToken, canonicalHash: audit.canonicalHash },
    data: { artifactStatus: "FINALIZED", artifactBytes: bytes, artifactByteLength: bytes.length, fileSha256 },
  });
  if (updated.count !== 1) throw new Error("Export reservation đã thay đổi trước khi finalize.");
  return tx.settlementExportAudit.findUniqueOrThrow({ where: { id: audit.id } });
}

export async function failSettlementExportArtifact(tx: Prisma.TransactionClient, auditId: string, reservationToken: string) {
  await tx.settlementExportAudit.updateMany({
    where: { id: auditId, artifactStatus: "RESERVED", reservationToken },
    data: { artifactStatus: "FAILED", artifactBytes: null, artifactByteLength: null, fileSha256: null },
  });
}

export async function readFinalizedSettlementExportArtifact(client: Pick<Prisma.TransactionClient, "settlementExportAudit">, auditId: string) {
  const audit = await client.settlementExportAudit.findUnique({ where: { id: auditId }, include: { sourceProjection: true } });
  if (!audit || audit.artifactStatus !== "FINALIZED" || !audit.artifactBytes || !audit.fileSha256 || !audit.artifactByteLength || !audit.sourceProjection) {
    throw new Error("Artifact chưa FINALIZED hoặc thiếu exact source identity.");
  }
  const bytes = Buffer.from(audit.artifactBytes);
  const hash = settlementFileHash(bytes);
  if (bytes.length !== audit.artifactByteLength || hash !== audit.fileSha256 || audit.canonicalHash !== audit.sourceProjection.projectionHash) {
    throw new Error("Artifact bytes/hash bị tamper hoặc không khớp source projection.");
  }
  return { audit, bytes: new Uint8Array(bytes) };
}

