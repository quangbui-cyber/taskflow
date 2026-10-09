import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizeLegacyActualCosts } from "./actualCost";
import type { FinanceData } from "./types";

type Actor = { id: string; role: string };

export type ActualCostReadLine = {
  id: string;
  stableLineId: string;
  source: "normalized" | "legacy";
  reviewState: "submitted" | "returned" | "approved" | "needsReview";
  approvalState: "APPROVED" | "RETURNED" | null;
  versionId: string | null;
  version: number | null;
  description: string;
  recipientKey: string;
  fundingSource: string | null;
  quantity: string | null;
  days: string | null;
  unitPrice: string | null;
  unit: string | null;
  amount: string;
  revisionId: string | null;
  icLineId: string | null;
  createdById: string | null;
  decisionReason: string;
  evidence: { id: string; kind: string; name: string; sha256: string; createdAt: string }[];
};

export async function loadActualCosts(projectId: string, actor: Actor) {
  const activeActor = await prisma.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true } });
  if (!activeActor) return null;
  const [project, ddGrant, normalized, workspace] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true, members: { select: { userId: true } } } }),
    prisma.workflowRoleGrant.findFirst({ where: { userId: activeActor.id, role: "AC_DD", revokedAt: null }, select: { id: true } }),
    prisma.actualCostLine.findMany({
      where: { projectId },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          include: {
            approvals: { orderBy: { createdAt: "desc" }, take: 1 },
            evidenceLinks: { include: { evidence: { select: { id: true, name: true, sha256: true, createdAt: true } } }, orderBy: { createdAt: "asc" } },
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

  const normalizedLines: ActualCostReadLine[] = normalized.flatMap(line => line.versions.map(version => {
    const decision = version.approvals[0];
    return {
      id: line.id,
      stableLineId: line.stableLineId,
      source: "normalized" as const,
      reviewState: version.state === "APPROVED" ? "approved" as const : version.state === "RETURNED" ? "returned" as const : "submitted" as const,
      approvalState: decision?.action === "APPROVED" || decision?.action === "RETURNED" ? decision.action : null,
      versionId: version.id,
      version: version.version,
      description: version.description,
      recipientKey: line.recipientKey,
      fundingSource: version.fundingSource,
      quantity: version.quantity,
      days: version.days,
      unitPrice: version.unitPrice,
      unit: version.unit,
      amount: version.amount,
      revisionId: line.icRevisionId,
      icLineId: line.icLineId,
      createdById: line.createdById,
      decisionReason: decision?.reason ?? "",
      evidence: version.evidenceLinks.map(link => ({ id: link.evidence.id, kind: link.kind, name: link.evidence.name, sha256: link.evidence.sha256, createdAt: link.evidence.createdAt.toISOString() })),
    };
  }));
  const normalizedKeys = new Set(normalized.flatMap(line => [line.id, line.stableLineId]));
  const data = workspace?.data as unknown as FinanceData | undefined;
  const legacyLines: ActualCostReadLine[] = normalizeLegacyActualCosts(data?.expenses ?? [])
    .filter(line => !normalizedKeys.has(line.id))
    .map(line => ({
      ...line,
      stableLineId: line.id,
      versionId: null,
      version: null,
      fundingSource: null,
      quantity: null,
      days: null,
      unitPrice: null,
      unit: null,
      revisionId: line.revisionId,
      createdById: null,
      decisionReason: "",
      evidence: [],
    }));
  return { lines: [...normalizedLines, ...legacyLines], canDecide: !!ddGrant };
}
