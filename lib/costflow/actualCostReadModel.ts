import "server-only";

import { prisma } from "@/lib/prisma";
import { ACTUAL_COST_EVIDENCE_KINDS, actualCostEvidenceWarnings, actualCostVariance, calculateActualCost, type ActualCostFundingAllocation, type ActualCostInternalStatus, type ActualCostSheetState } from "./actualCost";
import type { ActualCostFundingSource } from "./types";
import { calculateLineCost, totals, type CalculatedCost } from "./money";
import { buildActualCostControlCenter, resolveActualCostCapabilities, type ControlCenterPayment } from "./actualCostControlCenter";
import type { PaymentLedgerRow } from "./paymentReadModel";
import type { FinanceData } from "./types";

type Actor = { id: string; role: string };

export type ActualCostReadLine = {
  id: string;
  stableLineId: string;
  sourceKind: "IC_LINKED" | "UNBUDGETED" | "LEGACY";
  source: "normalized" | "legacy";
  reviewState: "submitted" | "returned" | "approved" | "needsReview";
  approvalState: "APPROVED" | "RETURNED" | null;
  approvalId: string | null;
  approvalAttemptId: string | null;
  versionId: string | null;
  version: number | null;
  reviewToken: string | null;
  description: string;
  sourceReason?: string;
  recipientKey: string;
  fundingSource: string | null;
  fundingAllocations?: ActualCostFundingAllocation[];
  internalStatus?: ActualCostInternalStatus;
  accountNote?: string;
  ddReturnNote?: string;
  quantity: string | null;
  days: string | null;
  unitPrice: string | null;
  basis: "NET" | "GROSS";
  vatPercent: string;
  unit: string | null;
  amount: string;
  cost: CalculatedCost | null;
  billable: boolean;
  saleSnapshot: { quantity: string; days: string; unitPrice: string } | null;
  revisionId: string | null;
  icLineId: string | null;
  createdById: string | null;
  lockedByApplications: boolean;
  applications: { requestId: string; amount: string; state: string; title: string }[];
  vendorInvoiceAppliedAmount: string;
  decisionReason: string;
  acknowledgedWarningCodes: string[];
  missingEvidenceWarnings: string[];
  evidence: { id: string; kind: string; name: string; mimeType: string; size: number; sha256: string; createdById: string; createdByName: string; createdAt: string }[];
};

export type ActualCostSheet = {
  revisionId: string | null;
  version: number;
  state: ActualCostSheetState;
  mutationVersion: number;
  manifestHash: string | null;
  migrationState: "AUTHORITATIVE" | "UNCONVERTED";
  totalGross: string;
  totalNet: string;
  totalVat: string;
  totalLines: number;
  reviewedLines: number;
  missingEvidenceLines: number;
  overBudgetLines: number;
  canSubmit: boolean;
  canDecide: boolean;
  blockingErrors: string[];
  warnings: string[];
  requestId?: string;
  lastReturnReason?: string;
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

export async function loadActualCosts(projectId: string, actor: Actor, paymentLedger: PaymentLedgerRow[] = []) {
  const activeActor = await prisma.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true } });
  if (!activeActor) return null;
  const [project, ddGrant, normalized, removed, evidenceVault, workspace, vendorInvoiceAllocations, actualCostWorkflowRequest, sheetAggregate] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true, members: { select: { userId: true, user: { select: { name: true, isActive: true } } } } } }),
    prisma.workflowRoleGrant.findFirst({ where: { userId: activeActor.id, role: "AC_DD", revokedAt: null }, select: { id: true } }),
    prisma.actualCostLine.findMany({
      where: { projectId, draftRemovedAt: null },
      include: {
        applications: { where: { state: "ACTIVE", request: { state: { notIn: ["WITHDRAWN", "REJECTED", "CANCELLED"] } } }, select: { requestId: true, amount: true, request: { select: { state: true, title: true } } } },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          include: {
            approvals: { orderBy: { createdAt: "desc" }, take: 1 },
            evidenceLinks: { include: { evidence: { select: { id: true, name: true, mimeType: true, data: true, sha256: true, createdBy: true, createdAt: true } } }, orderBy: { createdAt: "asc" } },
            fundingAllocations: { orderBy: { position: "asc" } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.actualCostLine.findMany({
      where: { projectId, draftRemovedAt: { not: null } },
      select: { id: true, createdById: true, versions: { orderBy: { version: "desc" }, take: 1, select: { description: true } } },
      orderBy: { draftRemovedAt: "desc" },
    }),
    prisma.costFlowEvidence.findMany({
      where: { projectId, kind: { in: [...ACTUAL_COST_EVIDENCE_KINDS] } },
      select: { id: true, name: true, kind: true, sha256: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.costFlowWorkspace.findUnique({ where: { projectId }, select: { data: true } }),
    prisma.vendorInvoiceActualCost.findMany({
      where: { projectId, applications: { some: { state: "ACTIVE" } } },
      select: { actualCostVersionId: true, allocatedAmount: true },
    }),
    prisma.workflowRequest.findFirst({
      where: { projectId, module: "COSTFLOW", kind: "ACTUAL_COST_APPROVAL" },
      orderBy: { createdAt: "desc" },
      select: { id: true, state: true },
    }),
    prisma.actualCostSheet.findUnique({
      where: { projectId },
      include: { revisions: { orderBy: { revision: "desc" }, take: 2 } },
    }),
  ]);
  if (!project) return null;
  const data = workspace?.data as unknown as FinanceData | undefined;
  const activeMemberIds = project.members.filter(member => member.user.isActive).map(member => member.userId);
  const capabilities = resolveActualCostCapabilities({
    actorId: activeActor.id,
    actorRole: activeActor.role,
    isProjectMember: activeMemberIds.includes(activeActor.id),
    isProjectOwner: project.ownerId === activeActor.id,
    isDd: !!ddGrant,
    accountantId: data?.config.accountantId ?? "",
    operationUserIds: (data?.config.operationUserIds ?? []).filter(id => activeMemberIds.includes(id)),
  });
  if (!capabilities.lenses.length) return null;
  const creatorIds = [...new Set(normalized.flatMap(line => line.versions.flatMap(version => version.evidenceLinks.map(link => link.evidence.createdBy))))];
  const creatorNames = new Map((await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })).map(user => [user.id, user.name]));

  const normalizedLines: ActualCostReadLine[] = normalized.flatMap(line => line.versions.map(version => {
    const decision = version.approvals[0];
    const snapshot = object(version.sourceSnapshot);
    const internalStatus = (typeof snapshot?.internalStatus === "string" ? snapshot.internalStatus : undefined) as ActualCostInternalStatus | undefined;
    const fundingAllocations = version.fundingAllocations.length
      ? version.fundingAllocations.map(allocation => ({ source: allocation.source, amount: allocation.amount })) as ActualCostFundingAllocation[]
      : Array.isArray(snapshot?.fundingAllocations)
      ? (snapshot.fundingAllocations as ActualCostFundingAllocation[])
      : [{ source: (version.fundingSource || "EMPLOYEE_OUT_OF_POCKET") as ActualCostFundingSource, amount: version.amount }];
    const accountNote = typeof snapshot?.accountNote === "string" ? snapshot.accountNote : undefined;
    const ddReturnNote = typeof snapshot?.ddReturnNote === "string" ? snapshot.ddReturnNote : undefined;
    return {
      id: line.id,
      stableLineId: line.stableLineId,
      sourceKind: line.sourceKind === "UNBUDGETED" ? "UNBUDGETED" as const : "IC_LINKED" as const,
      source: "normalized" as const,
      reviewState: version.state === "APPROVED" ? "approved" as const : version.state === "RETURNED" ? "returned" as const : version.state === "DRAFT" ? "needsReview" as const : "submitted" as const,
      approvalState: decision?.action === "APPROVED" || decision?.action === "RETURNED" ? decision.action : null,
      approvalId: decision?.id ?? null,
      approvalAttemptId: decision?.attemptId ?? null,
      versionId: version.id,
      version: version.version,
      reviewToken: `${version.id}:${version.version}`,
      description: version.description,
      sourceReason: typeof snapshot?.reason === "string" ? snapshot.reason : undefined,
      recipientKey: line.recipientKey,
      fundingSource: version.fundingSource,
      fundingAllocations,
      internalStatus: internalStatus ?? (version.state === "APPROVED" ? "ACCOUNT_REVIEWED" : "PENDING_ACCOUNT_REVIEW"),
      accountNote,
      ddReturnNote,
      quantity: version.quantity,
      days: version.days,
      unitPrice: version.unitPrice,
      basis: version.basis === "NET" ? "NET" : "GROSS",
      vatPercent: version.vatPercent,
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
      applications: line.applications.map(application => ({ requestId: application.requestId, amount: application.amount, state: application.request.state, title: application.request.title })),
      vendorInvoiceAppliedAmount: vendorInvoiceAllocations.filter(item => item.actualCostVersionId === version.id).reduce((sum, item) => sum + BigInt(item.allocatedAmount), BigInt(0)).toString(),
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
  const allLines = normalizedLines;
  const recipientNames = Object.fromEntries([
    ...project.members.map(member => [`USER:${member.userId}`, member.user.name] as const),
    ...(data?.beneficiaries ?? []).map(vendor => [`VENDOR:${vendor.id}`, vendor.name] as const),
  ]);
  const payments: ControlCenterPayment[] = paymentLedger
    .filter(item => item.projectId === projectId)
    .map(item => ({
      requestId: item.requestId,
      kind: item.kind,
      title: item.title,
      recipientKey: item.recipientKey,
      recipientLabel: item.recipientLabel,
      approvalState: item.approvalState,
      approvedAmount: item.approvedAmount,
      grossStandardOut: item.grossStandardOut,
      grossAdditionalOut: item.grossAdditionalOut,
      grossRefundedIn: item.grossRefundedIn,
      netCash: item.netCash,
      remainingStandardOut: item.remainingStandardOut,
      cashProgress: item.cashProgress,
    }));
  const controlCenter = buildActualCostControlCenter({
    actorId: activeActor.id,
    capabilities,
    occurrences: allLines.map(line => ({
      id: line.id,
      stableLineId: line.stableLineId,
      sourceKind: line.sourceKind,
      description: line.description,
      recipientKey: line.recipientKey,
      fundingSource: line.fundingSource,
      quantity: line.quantity,
      days: line.days,
      unitPrice: line.unitPrice,
      unit: line.unit,
      cost: line.cost,
      reviewState: line.reviewState,
      missingEvidenceWarnings: line.missingEvidenceWarnings,
      evidenceKinds: line.evidence.map(item => item.kind),
      lockedByApplications: line.lockedByApplications,
      applicationRequestIds: line.applications.map(item => item.requestId),
    })),
    comparisons,
    payments,
    milestones: (data?.vendorPaymentMilestones ?? []).map(item => ({ id: item.id, vendorId: item.vendorId, title: item.title, amount: item.amount, dueDate: item.dueDate, linkedRequestId: item.linkedRequestId })),
    recipientNames,
  });
  const lines = allLines.filter(line => capabilities.account || capabilities.audit
    || (capabilities.vendorOperations && line.recipientKey.startsWith("VENDOR:"))
    || line.recipientKey === `USER:${activeActor.id}`)
    .map(line => capabilities.vendorOperations && !capabilities.account && !capabilities.audit ? { ...line, evidence: [], decisionReason: "", acknowledgedWarningCodes: [] } : line);
  const scopedComparisons = controlCenter.worksheet.groups.map(group => ({
    key: group.key,
    sourceKind: group.sourceKind,
    description: group.description,
    unit: group.unit,
    ic: group.ic,
    actualLineIds: group.actualLineIds,
    actual: group.actual,
    variance: group.variance,
    status: group.status,
  }));
  const effectiveIcCosts = data?.revisions.find(revision => revision.effective)?.lines.flatMap(line => line.cost ? [line.cost] : []) ?? [];
  const summary = actualCostVariance(totals(effectiveIcCosts), lines.flatMap(line => line.cost ? [line.cost] : []));

  const persistedRevision = sheetAggregate?.revisions[0] ?? null;
  const sheetVersion = persistedRevision?.revision ?? 0;
  const sheetState: ActualCostSheetState = persistedRevision
    ? persistedRevision.state as ActualCostSheetState
    : "DRAFT";

  const totalGrossBig = normalizedLines.reduce((sum, l) => sum + BigInt(l.amount || "0"), BigInt(0));
  const totalNetBig = normalizedLines.reduce((sum, l) => sum + BigInt(l.cost?.net || "0"), BigInt(0));
  const totalVatBig = normalizedLines.reduce((sum, l) => sum + BigInt(l.cost?.vat || "0"), BigInt(0));

  const reviewedLines = normalizedLines.filter(l => l.internalStatus === "ACCOUNT_REVIEWED").length;
  const missingEvidenceLines = normalizedLines.filter(l => l.missingEvidenceWarnings.length > 0).length;
  const overBudgetLines = scopedComparisons.filter(c => c.status === "OVER_BUDGET").length;

  const blockingErrors: string[] = [];
  if (normalizedLines.length === 0) {
    blockingErrors.push("Bảng AC chưa có dòng chi phí nào.");
  }
  const unreviewedCount = normalizedLines.length - reviewedLines;
  if (unreviewedCount > 0) {
    blockingErrors.push(`${unreviewedCount} dòng chưa được Account kiểm tra.`);
  }

  const warnings: string[] = [];
  if (missingEvidenceLines > 0) {
    warnings.push(`${missingEvidenceLines} dòng chưa đủ chứng từ cốt lõi (BBNT, Hóa đơn VAT, UNC).`);
  }
  if (overBudgetLines > 0) {
    warnings.push(`${overBudgetLines} nhóm chi phí đang vượt ngân sách IC.`);
  }

  const canSubmit = capabilities.account && sheetState === "DRAFT" && blockingErrors.length === 0;

  const sheet: ActualCostSheet = {
    revisionId: persistedRevision?.id ?? null,
    version: sheetVersion,
    state: sheetState,
    mutationVersion: persistedRevision?.mutationVersion ?? 0,
    manifestHash: persistedRevision?.manifestHash ?? null,
    migrationState: persistedRevision ? "AUTHORITATIVE" : "UNCONVERTED",
    totalGross: totalGrossBig.toString(),
    totalNet: totalNetBig.toString(),
    totalVat: totalVatBig.toString(),
    totalLines: normalizedLines.length,
    reviewedLines,
    missingEvidenceLines,
    overBudgetLines,
    canSubmit,
    canDecide: capabilities.canDecide && sheetState === "SUBMITTED",
    blockingErrors,
    warnings,
    requestId: persistedRevision?.workflowRequestId ?? actualCostWorkflowRequest?.id,
    lastReturnReason: sheetAggregate?.revisions.find(revision => revision.state === "RETURNED")?.decisionReason || undefined,
  };

  const removedLines = removed
    .filter(line => capabilities.account || line.createdById === activeActor.id)
    .map(line => ({ id: line.id, description: line.versions[0]?.description ?? "Khoản thực chi", createdById: line.createdById }));
  return { lines, removedLines, evidenceVault, comparisons: scopedComparisons, summary, canDecide: capabilities.canDecide, controlCenter, sheet };
}
