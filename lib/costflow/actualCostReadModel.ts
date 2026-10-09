import "server-only";

import { prisma } from "@/lib/prisma";
import { actualCostEvidenceWarnings, actualCostVariance, calculateActualCost, normalizeLegacyActualCosts } from "./actualCost";
import { calculateLineCost, totals, type CalculatedCost } from "./money";
import type { FinanceData } from "./types";

type Actor = { id: string; role: string };

export type ActualCostReadLine = {
  id: string;
  stableLineId: string;
  sourceKind: "IC_LINKED" | "UNBUDGETED" | "LEGACY";
  source: "normalized" | "legacy";
  reviewState: "submitted" | "returned" | "approved" | "needsReview";
  approvalState: "APPROVED" | "RETURNED" | null;
  versionId: string | null;
  version: number | null;
  reviewToken: string | null;
  description: string;
  recipientKey: string;
  fundingSource: string | null;
  quantity: string | null;
  days: string | null;
  unitPrice: string | null;
  unit: string | null;
  amount: string;
  cost: CalculatedCost | null;
  billable: boolean;
  saleSnapshot: { quantity: string; days: string; unitPrice: string } | null;
  revisionId: string | null;
  icLineId: string | null;
  createdById: string | null;
  lockedByApplications: boolean;
  decisionReason: string;
  acknowledgedWarningCodes: string[];
  missingEvidenceWarnings: string[];
  evidence: { id: string; kind: string; name: string; mimeType: string; size: number; sha256: string; createdById: string; createdByName: string; createdAt: string }[];
};

export type ActualCostComparison = {
  key: string;
  sourceKind: "IC_LINKED" | "UNBUDGETED";
  description: string;
  unit: string;
  ic: { quantity: string; days: string; unitPrice: string; cost: CalculatedCost } | null;
  actualLineIds: string[];
  actual: CalculatedCost;
  variance: CalculatedCost;
  status: "OVER_BUDGET" | "SAVING" | "ON_BUDGET";
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function loadActualCosts(projectId: string, actor: Actor) {
  const activeActor = await prisma.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true } });
  if (!activeActor) return null;
  const [project, ddGrant, normalized, workspace] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true, members: { select: { userId: true } } } }),
    prisma.workflowRoleGrant.findFirst({ where: { userId: activeActor.id, role: "AC_DD", revokedAt: null }, select: { id: true } }),
    prisma.actualCostLine.findMany({
      where: { projectId },
      include: {
        applications: { where: { state: "ACTIVE", request: { state: { notIn: ["WITHDRAWN", "REJECTED", "CANCELLED"] } } }, select: { id: true } },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          include: {
            approvals: { orderBy: { createdAt: "desc" }, take: 1 },
            evidenceLinks: { include: { evidence: { select: { id: true, name: true, mimeType: true, data: true, sha256: true, createdBy: true, createdAt: true } } }, orderBy: { createdAt: "asc" } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.costFlowWorkspace.findUnique({ where: { projectId }, select: { data: true } }),
  ]);
  if (!project) return null;
  const fullAccess = activeActor.role === "ADMIN" || !!ddGrant || project.members.some(member => member.userId === activeActor.id);
  if (!fullAccess) return null;
  const creatorIds = [...new Set(normalized.flatMap(line => line.versions.flatMap(version => version.evidenceLinks.map(link => link.evidence.createdBy))))];
  const creatorNames = new Map((await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })).map(user => [user.id, user.name]));

  const normalizedLines: ActualCostReadLine[] = normalized.flatMap(line => line.versions.map(version => {
    const decision = version.approvals[0];
    return {
      id: line.id,
      stableLineId: line.stableLineId,
      sourceKind: line.sourceKind === "UNBUDGETED" ? "UNBUDGETED" as const : "IC_LINKED" as const,
      source: "normalized" as const,
      reviewState: version.state === "APPROVED" ? "approved" as const : version.state === "RETURNED" ? "returned" as const : "submitted" as const,
      approvalState: decision?.action === "APPROVED" || decision?.action === "RETURNED" ? decision.action : null,
      versionId: version.id,
      version: version.version,
      reviewToken: `${version.id}:${version.version}`,
      description: version.description,
      recipientKey: line.recipientKey,
      fundingSource: version.fundingSource,
      quantity: version.quantity,
      days: version.days,
      unitPrice: version.unitPrice,
      unit: version.unit,
      amount: version.amount,
      cost: calculateActualCost({ quantity: version.quantity, days: version.days, unitPrice: version.unitPrice, basis: version.basis === "NET" ? "NET" : "GROSS", vatPercent: version.vatPercent }).cost,
      billable: version.billable,
      saleSnapshot: object(version.saleSnapshot) ? {
        quantity: String(object(version.saleSnapshot)?.quantity ?? ""),
        days: String(object(version.saleSnapshot)?.days ?? ""),
        unitPrice: String(object(version.saleSnapshot)?.unitPrice ?? ""),
      } : null,
      revisionId: line.icRevisionId,
      icLineId: line.icLineId,
      createdById: line.createdById,
      lockedByApplications: line.applications.length > 0,
      decisionReason: decision?.reason ?? "",
      acknowledgedWarningCodes: Array.isArray(decision?.warningCodes) ? decision.warningCodes.filter((value): value is string => typeof value === "string") : [],
      missingEvidenceWarnings: actualCostEvidenceWarnings(version.evidenceLinks.map(link => link.kind)),
      evidence: version.evidenceLinks.map(link => ({
        id: link.evidence.id,
        kind: link.kind,
        name: link.evidence.name,
        mimeType: link.evidence.mimeType,
        size: link.evidence.data.byteLength,
        sha256: link.evidence.sha256,
        createdById: link.evidence.createdBy,
        createdByName: creatorNames.get(link.evidence.createdBy) ?? "Người dùng",
        createdAt: link.evidence.createdAt.toISOString(),
      })),
    };
  }));
  const normalizedKeys = new Set(normalized.flatMap(line => [line.id, line.stableLineId]));
  const data = workspace?.data as unknown as FinanceData | undefined;
  const legacyCostById = new Map((data?.expenses ?? []).map(expense => [expense.id, expense.cost]));
  const legacyLines: ActualCostReadLine[] = normalizeLegacyActualCosts(data?.expenses ?? [])
    .filter(line => !normalizedKeys.has(line.id))
    .map(line => ({
      ...line,
      stableLineId: line.id,
      sourceKind: "LEGACY" as const,
      versionId: null,
      version: null,
      reviewToken: null,
      fundingSource: null,
      quantity: null,
      days: null,
      unitPrice: null,
      unit: null,
      cost: legacyCostById.get(line.id) ?? null,
      billable: false,
      saleSnapshot: null,
      revisionId: line.revisionId,
      createdById: null,
      lockedByApplications: false,
      decisionReason: "",
      acknowledgedWarningCodes: [],
      missingEvidenceWarnings: [],
      evidence: [],
    }));
  const groups = new Map<string, { sourceKind: "IC_LINKED" | "UNBUDGETED"; description: string; unit: string; ic: ActualCostComparison["ic"]; lines: ActualCostReadLine[] }>();
  for (const line of normalizedLines) {
    if (!line.cost) continue;
    const snapshot = object(normalized.find(item => item.id === line.id)?.versions[0]?.sourceSnapshot);
    const key = line.sourceKind === "IC_LINKED" ? `${line.revisionId}:${line.icLineId}` : `UNBUDGETED:${line.id}`;
    const sourceCost = object(snapshot?.cost);
    const ic = line.sourceKind === "IC_LINKED" && snapshot && sourceCost ? {
      quantity: String(snapshot.quantity ?? ""),
      days: String(snapshot.days ?? "1"),
      unitPrice: String(snapshot.unitPrice ?? ""),
      cost: calculateLineCost({
        quantity: String(snapshot.quantity ?? "0"),
        days: String(snapshot.days ?? "1"),
        unitPrice: String(snapshot.unitPrice ?? "0"),
        basis: snapshot.basis === "NET" ? "NET" : "GROSS",
        vatPercent: String(snapshot.vatPercent ?? "0"),
      }),
    } : null;
    const group = groups.get(key) ?? { sourceKind: line.sourceKind as "IC_LINKED" | "UNBUDGETED", description: line.description, unit: line.unit ?? "", ic, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  const comparisons: ActualCostComparison[] = [...groups.entries()].map(([key, group]) => {
    const zero: CalculatedCost = { rawNet: "0/1", rawVat: "0/1", rawGross: "0/1", net: "0", vat: "0", gross: "0" };
    const comparison = actualCostVariance(group.ic?.cost ?? zero, group.lines.flatMap(line => line.cost ? [line.cost] : []));
    return { key, sourceKind: group.sourceKind, description: group.description, unit: group.unit, ic: group.ic, actualLineIds: group.lines.map(line => line.id), actual: comparison.actual, variance: comparison.variance, status: comparison.status };
  });
  const zero: CalculatedCost = { rawNet: "0/1", rawVat: "0/1", rawGross: "0/1", net: "0", vat: "0", gross: "0" };
  const icTotal = comparisons.length ? totals(comparisons.flatMap(item => item.ic ? [item.ic.cost] : [])) : zero;
  const summary = actualCostVariance(icTotal, normalizedLines.flatMap(line => line.cost ? [line.cost] : []));
  return { lines: [...normalizedLines, ...legacyLines], comparisons, summary, canDecide: !!ddGrant };
}
