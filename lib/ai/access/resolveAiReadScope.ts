import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const AI_SOURCE_KINDS = [
  "PROJECT_FILE", "COSTFLOW_EVIDENCE", "EXCEL_INTAKE_SOURCE", "VENDOR_INVOICE_FILE",
  "COSTFLOW_PO", "COSTFLOW_IC", "FINANCE_SHEET",
] as const;
export type AiSourceKind = (typeof AI_SOURCE_KINDS)[number];
export type AiSourceRef = { kind: AiSourceKind; id: string };
export type AiSourceMetadata = AiSourceRef & {
  projectId: string;
  name: string;
  mimeType: string;
  version: string;
  authorityStatus: string;
  immutable: boolean;
  businessKey: string | null;
};
export type AiReadScope = {
  projectId: string;
  actorId: string;
  scopeKey: string;
  scopeHash: string;
  sources: AiSourceMetadata[];
  role: string;
  isOwner: boolean;
  dataClasses: readonly string[];
};

export class AiSourceNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor() { super("Not found"); }
}

export function parseAiSourceSelection(sourceIds: readonly string[]): AiSourceRef[] {
  if (!Array.isArray(sourceIds) || sourceIds.length < 1 || sourceIds.length > 2) {
    throw new Error("Select one document or one related invoice pair.");
  }
  const parsed = sourceIds.map((sourceId) => {
    if (typeof sourceId !== "string") throw new Error("Invalid source reference.");
    const separator = sourceId.indexOf(":");
    const kind = sourceId.slice(0, separator) as AiSourceKind;
    const id = sourceId.slice(separator + 1);
    if (separator < 1 || !AI_SOURCE_KINDS.includes(kind) || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      throw new Error("Invalid source reference.");
    }
    return { kind, id };
  });
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error("Duplicate source reference.");
  if (parsed.length === 2 && parsed.some((source) => source.kind !== "VENDOR_INVOICE_FILE")) {
    throw new Error("Only a related XML/PDF invoice pair may form a bundle.");
  }
  return parsed;
}

export type AiScopeReader = {
  actor(id: string): Promise<{ id: string; role: string; isActive: boolean } | null>;
  project(id: string): Promise<{ id: string; ownerId: string; memberIds: string[] } | null>;
  source(ref: AiSourceRef, projectId: string): Promise<AiSourceMetadata | null>;
};

export function financeRecordBytes(record: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(record));
}

export function financeRecordVersion(record: unknown): string {
  return createHash("sha256").update(financeRecordBytes(record)).digest("hex");
}

export const prismaAiScopeReader: AiScopeReader = {
  async actor(id) {
    return prisma.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true } });
  },
  async project(id) {
    const project = await prisma.project.findUnique({
      where: { id }, select: { id: true, ownerId: true, members: { select: { userId: true } } },
    });
    return project && { id: project.id, ownerId: project.ownerId, memberIds: project.members.map((member) => member.userId) };
  },
  async source(ref, projectId) {
    if (ref.kind === "COSTFLOW_PO" || ref.kind === "COSTFLOW_IC") {
      const workspace = await prisma.costFlowWorkspace.findUnique({ where: { projectId }, select: { data: true } });
      const data = workspace?.data as Record<string, unknown> | undefined;
      const records = data?.[ref.kind === "COSTFLOW_PO" ? "pos" : "revisions"];
      const record = Array.isArray(records) ? records.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === ref.id) : null;
      return record ? { ...ref, projectId, name: ref.kind === "COSTFLOW_PO" ? `PO ${ref.id}` : `IC ${ref.id}`,
        mimeType: "application/json", version: financeRecordVersion(record),
        authorityStatus: "VERSIONED", immutable: false, businessKey: null } : null;
    }
    if (ref.kind === "FINANCE_SHEET") {
      const sheet = await prisma.financeSheet.findFirst({ where: { id: ref.id, projectId },
        select: { id: true, version: true, icStatus: true, superseded: true,
          clientName: true, programName: true, sellSubtotal: true, icCostSubtotal: true } });
      return sheet && { ...ref, projectId, name: `Finance sheet ${sheet.version}`,
        mimeType: "application/json", version: financeRecordVersion(sheet),
        authorityStatus: sheet.superseded ? "SUPERSEDED" : sheet.icStatus,
        immutable: false, businessKey: null };
    }
    if (ref.kind === "PROJECT_FILE") {
      const file = await prisma.projectFile.findFirst({
        where: { id: ref.id, projectId },
        select: { id: true, projectId: true, name: true, mimeType: true, createdAt: true, driveFileId: true },
      });
      return file && !file.driveFileId ? {
        ...ref, projectId, name: file.name, mimeType: file.mimeType,
        version: file.createdAt.toISOString(), authorityStatus: "UPLOADED", immutable: false,
        businessKey: null,
      } : null;
    }
    if (ref.kind === "COSTFLOW_EVIDENCE") {
      const evidence = await prisma.costFlowEvidence.findFirst({
        where: { id: ref.id, projectId },
        select: { id: true, name: true, mimeType: true, sha256: true, kind: true },
      });
      return evidence && { ...ref, projectId, name: evidence.name, mimeType: evidence.mimeType,
        version: evidence.sha256, authorityStatus: evidence.kind, immutable: true, businessKey: null };
    }
    if (ref.kind === "EXCEL_INTAKE_SOURCE") {
      const evidence = await prisma.excelIntakeSourceEvidence.findFirst({
        where: { id: ref.id, projectId },
        select: { filename: true, mimeType: true, sha256: true },
      });
      return evidence && { ...ref, projectId, name: evidence.filename,
        mimeType: evidence.mimeType ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        version: evidence.sha256, authorityStatus: "CONFIRMED", immutable: true, businessKey: null };
    }
    const file = await prisma.vendorInvoiceFile.findFirst({
      where: { id: ref.id, invoice: { projectId } },
      select: { name: true, mimeType: true, sha256: true, format: true,
        invoice: { select: { businessKey: true } } },
    });
    return file && { ...ref, projectId, name: file.name, mimeType: file.mimeType,
      version: file.sha256, authorityStatus: "CONFIRMED", immutable: true,
      businessKey: file.invoice.businessKey };
  },
};

export async function resolveAiReadScope(
  actorId: string,
  input: { projectId: string; sourceIds: readonly string[]; purpose: string },
  reader: AiScopeReader = prismaAiScopeReader,
): Promise<AiReadScope> {
  const selection = parseAiSourceSelection(input.sourceIds);
  const [actor, project] = await Promise.all([reader.actor(actorId), reader.project(input.projectId)]);
  if (!actor?.isActive || !project ||
      (actor.role !== "ADMIN" && project.ownerId !== actorId && !project.memberIds.includes(actorId))) {
    throw new AiSourceNotFoundError();
  }
  const sources: AiSourceMetadata[] = [];
  for (const ref of selection) {
    const metadata = await reader.source(ref, project.id);
    if (!metadata || metadata.projectId !== project.id) throw new AiSourceNotFoundError();
    sources.push(metadata);
  }
  if (sources.length === 2) {
    const roles = new Set(sources.map((source) => source.mimeType === "application/pdf" ? "PDF" :
      ["application/xml", "text/xml"].includes(source.mimeType) ? "XML" : "INVALID"));
    if (roles.size !== 2 || !roles.has("XML") || !roles.has("PDF") ||
        !sources[0].businessKey || sources[0].businessKey !== sources[1].businessKey) {
      throw new AiSourceNotFoundError();
    }
  }
  const scopeKey = `PROJECT:${project.id}`;
  const scopeHash = createHash("sha256").update(JSON.stringify({
    actorId, role: actor.role, ownerId: project.ownerId,
    memberIds: [...project.memberIds].sort(), projectId: project.id, purpose: input.purpose,
    sources: sources.map(({ kind, id, version, authorityStatus }) => ({ kind, id, version, authorityStatus })),
  })).digest("hex");
  return { projectId: project.id, actorId, scopeKey, scopeHash, sources,
    role: actor.role, isOwner: project.ownerId === actorId,
    dataClasses: ["PROJECT", "FINANCE_EVIDENCE"] };
}
