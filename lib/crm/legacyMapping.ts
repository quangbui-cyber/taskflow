import type { Prisma, Project } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { vnDateKey } from "./dates";

export const LEGACY_BACKFILL_CUTOFF = new Date("2026-07-15T17:00:00.000Z");
export const LEGACY_IMPORT_ACTOR_NAME = "Chuyển dữ liệu cũ";
export type LegacyClassification = "MIGRATE" | "NEEDS_REVIEW" | "BLOCKED" | "MISSING_CLIENT";
export type LegacyProjectFacts = Pick<Project, "id" | "category" | "status" | "onProcessAt" | "completedAt" | "purchaseOrderNumber" | "sourceOpportunityId" | "clientId" | "createdAt" | "revenue"> & {
  financeSheetCount: number; approvedIcFinanceSheetCount: number; alreadyMigrated: boolean;
};
export function classifyLegacyProject(p: Omit<LegacyProjectFacts, "category"> & { category: string }): { classification: LegacyClassification; reasons: string[] } | null {
  if (p.category !== "CLIENT" || !["BIDDING", "FAIL", "CANCEL"].includes(p.status) || p.onProcessAt || p.completedAt || p.purchaseOrderNumber !== null || p.sourceOpportunityId || p.alreadyMigrated) return null;
  const reasons: string[] = [];
  if (p.createdAt < LEGACY_BACKFILL_CUTOFF && ["FAIL", "CANCEL"].includes(p.status)) reasons.push("BEFORE_BACKFILL");
  if (p.status === "CANCEL" && p.revenue > 0) reasons.push("CANCEL_WITH_REVENUE");
  if (p.approvedIcFinanceSheetCount > 0) reasons.push("IC_APPROVED");
  const review = reasons.length > 0;
  if (p.financeSheetCount > 0) reasons.push("HAS_FINANCE_SHEET");
  if (!p.clientId) reasons.push("NO_CLIENT");
  return { classification: p.financeSheetCount > 0 ? "BLOCKED" : review ? "NEEDS_REVIEW" : !p.clientId ? "MISSING_CLIENT" : "MIGRATE", reasons };
}
type MappingProject = Pick<Project, "id" | "name" | "status" | "type" | "clientId" | "ownerId" | "accountId" | "createdAt" | "revenue" | "executionStartAt" | "executionEndAt">;
export function legacyClosedAtSource(p: MappingProject) { return p.executionEndAt ? "executionEndAt" : p.executionStartAt ? "executionStartAt" : "createdAt"; }
export function mapLegacyProjectToOpportunity(p: MappingProject, opts: { opportunityId: string }): Prisma.OpportunityUncheckedCreateInput {
  if (!p.clientId) throw new Error("Legacy Project requires a Client before migration");
  const [year, month] = vnDateKey(p.executionStartAt ?? p.createdAt).split("-").map(Number);
  const closed = p.status !== "BIDDING";
  return { id: opts.opportunityId, name: p.name, clientId: p.clientId, programTypeCode: p.type, expectedYear: year, expectedMonth: p.executionStartAt ? month : null,
    source: "OTHER", demandSignal: `Dữ liệu cũ từ dự án ${p.name}`, budgetMax: p.revenue > 0 ? p.revenue : null, stage: "BIDDING", outcome: closed ? "LEGACY_UNCLASSIFIED" : null,
    legacyStatus: closed ? p.status : null, closedAt: closed ? p[legacyClosedAtSource(p)] : null, picAccountId: p.accountId, responsibleTeamId: null, createdById: p.ownerId, createdAt: p.createdAt, legacyProjectId: p.id, version: 0 };
}
export function legacyDriveKeyPairs(projectId: string, opportunityId: string, existingKeys: string[]) {
  const root = `project:${projectId}`;
  return existingKeys.filter((key) => key === root || key.startsWith(`${root}:`)).map((from) => ({ from, to: `opportunity:${opportunityId}${from.slice(root.length)}` }));
}
export function serializeSnapshotRow(row: unknown): Prisma.InputJsonValue | null {
  if (row === null) return null;
  if (row instanceof Date) return { $date: row.toISOString() };
  if (Decimal.isDecimal(row)) return { $decimal: row.toString() };
  if (Array.isArray(row)) return row.map(serializeSnapshotRow);
  if (typeof row === "object") return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, serializeSnapshotRow(value)]));
  if (typeof row === "string" || typeof row === "boolean" || typeof row === "number" && Number.isFinite(row)) return row;
  throw new Error("Unsupported snapshot value");
}
export function deserializeSnapshotRow<T = unknown>(json: unknown): T {
  function decode(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      if (Object.keys(row).length === 1 && typeof row.$date === "string") return new Date(row.$date);
      if (Object.keys(row).length === 1 && typeof row.$decimal === "string") return new Decimal(row.$decimal);
      return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, decode(item)]));
    }
    return value;
  }
  return decode(json) as T;
}
