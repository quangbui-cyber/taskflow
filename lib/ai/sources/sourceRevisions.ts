import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AiSourceKind, AiSourceMetadata } from "@/lib/ai/access/resolveAiReadScope";
import { AiSourceNotFoundError, financeRecordBytes, financeRecordVersion } from "@/lib/ai/access/resolveAiReadScope";

type Snapshot = { id: string; sha256: string };
export type AiSourceStore = {
  readBytes(source: AiSourceMetadata): Promise<Uint8Array>;
  findRevision(kind: AiSourceKind, id: string, version: string, sha256: string): Promise<Snapshot | null>;
  createRevision(input: {
    projectId: string; scopeKey: string; originKind: AiSourceKind; originId: string;
    originVersion: string; sha256: string; filename: string; mimeType: string;
    byteLength: number; authorityStatus: string; snapshotBytes: Uint8Array | null; createdById: string;
  }): Promise<Snapshot>;
};

export const prismaAiSourceStore: AiSourceStore = {
  async readBytes(source) {
    if (source.kind === "COSTFLOW_PO" || source.kind === "COSTFLOW_IC") {
      const workspace = await prisma.costFlowWorkspace.findUnique({ where: { projectId: source.projectId }, select: { data: true } });
      const data = workspace?.data as Record<string, unknown> | undefined;
      const records = data?.[source.kind === "COSTFLOW_PO" ? "pos" : "revisions"];
      const record = Array.isArray(records) ? records.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === source.id) : null;
      if (!record || financeRecordVersion(record) !== source.version) throw new AiSourceNotFoundError();
      return financeRecordBytes(record);
    }
    if (source.kind === "FINANCE_SHEET") {
      const sheet = await prisma.financeSheet.findFirst({ where: { id: source.id, projectId: source.projectId },
        select: { id: true, version: true, icStatus: true, superseded: true,
          clientName: true, programName: true, sellSubtotal: true, icCostSubtotal: true } });
      if (!sheet || financeRecordVersion(sheet) !== source.version) throw new AiSourceNotFoundError();
      return financeRecordBytes(sheet);
    }
    if (source.kind === "PROJECT_FILE") {
      const file = await prisma.projectFile.findFirst({ where: { id: source.id, projectId: source.projectId },
        select: { data: true, createdAt: true } });
      if (!file?.data || file.createdAt.toISOString() !== source.version) throw new AiSourceNotFoundError();
      return file.data;
    }
    if (source.kind === "COSTFLOW_EVIDENCE") {
      const evidence = await prisma.costFlowEvidence.findFirst({ where: { id: source.id, projectId: source.projectId },
        select: { data: true, sha256: true } });
      if (!evidence || evidence.sha256 !== source.version) throw new AiSourceNotFoundError();
      return evidence.data;
    }
    if (source.kind === "EXCEL_INTAKE_SOURCE") {
      const evidence = await prisma.excelIntakeSourceEvidence.findFirst({ where: { id: source.id, projectId: source.projectId },
        select: { data: true, sha256: true } });
      if (!evidence || evidence.sha256 !== source.version) throw new AiSourceNotFoundError();
      return evidence.data;
    }
    const file = await prisma.vendorInvoiceFile.findFirst({ where: { id: source.id, invoice: { projectId: source.projectId } },
      select: { data: true, sha256: true } });
    if (!file || file.sha256 !== source.version) throw new AiSourceNotFoundError();
    return file.data;
  },
  async findRevision(kind, id, version, sha256) {
    return prisma.aiSourceRevision.findUnique({
      where: { originKind_originId_originVersion_sha256: {
        originKind: kind, originId: id, originVersion: version, sha256,
      } }, select: { id: true, sha256: true },
    });
  },
  async createRevision(input) {
    return prisma.aiSourceRevision.create({ data: {
      ...input, snapshotBytes: input.snapshotBytes ? Buffer.from(input.snapshotBytes) : null,
    }, select: { id: true, sha256: true } });
  },
};

export async function snapshotSelectedAiSources(
  actorId: string, sources: readonly AiSourceMetadata[], store: AiSourceStore = prismaAiSourceStore,
): Promise<Snapshot[]> {
  const revisions: Snapshot[] = [];
  for (const source of sources) {
    const bytes = await store.readBytes(source);
    if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024) throw new AiSourceNotFoundError();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (source.immutable && source.version !== sha256) throw new AiSourceNotFoundError();
    const existing = await store.findRevision(source.kind, source.id, source.version, sha256);
    if (existing) { revisions.push(existing); continue; }
    try {
      revisions.push(await store.createRevision({
        projectId: source.projectId, scopeKey: `PROJECT:${source.projectId}`,
        originKind: source.kind, originId: source.id, originVersion: source.version,
        sha256, filename: source.name, mimeType: source.mimeType, byteLength: bytes.byteLength,
        authorityStatus: source.authorityStatus, snapshotBytes: source.immutable ? null : bytes,
        createdById: actorId,
      }));
    } catch (error) {
      const raced = await store.findRevision(source.kind, source.id, source.version, sha256);
      if (!raced) throw error;
      revisions.push(raced);
    }
  }
  return revisions;
}
