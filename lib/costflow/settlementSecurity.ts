import { createHash } from "node:crypto";
import type { SettlementExportProjection } from "./export";

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

