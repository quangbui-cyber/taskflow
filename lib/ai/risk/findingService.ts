import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exact, source, sum } from "@/lib/costflow/money";
import { AiSourceNotFoundError, requireAiProjectRead } from "@/lib/ai/access/resolveAiReadScope";
import { readAiRun } from "@/lib/ai/runs/aiRunService";
import { evaluateDeterministicFindings } from "./rules";

export type FindingResolution = "FIXED" | "EXCEPTION_ACCEPTED" | "FALSE_POSITIVE" | "NEEDS_MORE";
const resolutions = new Set<FindingResolution>(["FIXED", "EXCEPTION_ACCEPTED", "FALSE_POSITIVE", "NEEDS_MORE"]);

export function routeForFinding(kind: string, ruleCode: string) {
  if (/SECURITY|ACCESS|LEAK|INJECTION/i.test(ruleCode)) return "ADMIN";
  if (/VAT|INVOICE|SUPPLIER|VENDOR|NCC/i.test(`${kind} ${ruleCode}`)) return "ACCOUNTANT";
  return "ACCOUNT_OWNER";
}

export function canResolveRoute(actor: { id: string; role: string }, projectOwnerId: string,
  finding: { route: string; ownerId: string | null }) {
  if (actor.role === "ADMIN") return true;
  if (finding.route === "ADMIN") return false;
  if (finding.route === "ACCOUNTANT") return actor.role === "ACCOUNTANT";
  return actor.id === projectOwnerId || (actor.role === "ACCOUNT" && finding.ownerId === actor.id);
}

async function sourceUploader(projectId: string, originKind: string, originId: string, fallback: string) {
  if (originKind === "PROJECT_FILE") {
    const file = await prisma.projectFile.findFirst({ where: { id: originId, projectId }, select: { uploaderId: true } });
    return file?.uploaderId ?? fallback;
  }
  if (originKind === "VENDOR_INVOICE_FILE") {
    const file = await prisma.vendorInvoiceFile.findFirst({ where: { id: originId, invoice: { projectId } },
      select: { createdById: true } });
    return file?.createdById ?? fallback;
  }
  if (originKind === "COSTFLOW_EVIDENCE") {
    const evidence = await prisma.costFlowEvidence.findFirst({ where: { id: originId, projectId },
      select: { createdBy: true } });
    return evidence?.createdBy ?? fallback;
  }
  return fallback;
}

async function visibleRun(actorId: string, projectId: string, runId: string) {
  await readAiRun(actorId, projectId, runId);
  return prisma.aiRun.findFirst({ where: { id: runId, projectId },
    select: { id: true, actorId: true, scopeKey: true, runType: true, status: true, outcomeCode: true,
      sources: { select: { sourceRevision: { select: { createdById: true, originKind: true, originId: true } } } } } });
}

export async function evaluateAndPersistAiFindings(actorId: string, projectId: string, runId: string) {
  const run = await visibleRun(actorId, projectId, runId);
  if (!run || run.actorId !== actorId || !["SUCCEEDED", "FAILED"].includes(run.status)) {
    throw new AiSourceNotFoundError();
  }
  const sourceKind = run.sources[0]?.sourceRevision.originKind ?? "DOCUMENT";
  const originId = run.sources[0]?.sourceRevision.originId;
  const invoiceFile = sourceKind === "VENDOR_INVOICE_FILE" && originId ?
    await prisma.vendorInvoiceFile.findFirst({ where: { id: originId, invoice: { projectId } }, select: { invoiceId: true } }) : null;
  const relatedInvoiceId = invoiceFile?.invoiceId ?? null;
  const relatedApplications = relatedInvoiceId ? await prisma.vendorInvoiceApplication.findMany({
    where: { invoiceId: relatedInvoiceId, projectId, state: "ACTIVE", paymentLineId: { not: null } },
    select: { paymentLineId: true },
  }) : [];
  const invoiceLinks = relatedInvoiceId ? await prisma.vendorInvoiceActualCost.findMany({
    where: { invoiceId: relatedInvoiceId, projectId },
    select: { id: true, actualCostLineId: true, actualCostVersionId: true, approvalId: true },
  }) : [];
  const relatedAcLineIds = invoiceLinks.map((link) => link.actualCostLineId);
  const [fields, invoices, cashLines, acLines] = await Promise.all([
    prisma.aiCandidateField.findMany({ where: { runId, scopeKey: run.scopeKey },
      select: { id: true, rowKey: true, fieldKey: true, aiValue: true, provenance: true,
        confidence: true, sourceSpanId: true } }),
    prisma.vendorInvoice.findMany({ where: { projectId, ...(relatedInvoiceId ? { id: { not: relatedInvoiceId } } : {}) },
      select: { id: true, sellerTaxCode: true, symbol: true, invoiceNumber: true, issuedAt: true } }),
    prisma.paymentRequestLine.findMany({ where: { projectId,
      ...(sourceKind === "COSTFLOW_IC" && originId ? { icRevisionId: originId } :
        { id: { in: relatedApplications.flatMap((item) => item.paymentLineId ? [item.paymentLineId] : []) } }) },
      select: { id: true, amount: true, request: { select: { state: true } },
        cashAllocations: { where: { direction: "OUT" }, select: { amount: true } } } }),
    prisma.actualCostLine.findMany({ where: { projectId,
      ...(sourceKind === "COSTFLOW_IC" && originId ? { icRevisionId: originId } :
        { id: { in: relatedAcLineIds } }) },
      select: { id: true, currentVersion: true,
        versions: { select: { id: true, version: true, state: true,
          evidenceLinks: { select: { id: true } }, approvals: { select: { id: true, action: true } } } } } }),
  ]);
  if (sourceKind === "COSTFLOW_IC" && originId) {
    invoiceLinks.push(...await prisma.vendorInvoiceActualCost.findMany({ where: {
      projectId, actualCostLineId: { in: acLines.map((line) => line.id) } },
      select: { id: true, actualCostLineId: true, actualCostVersionId: true, approvalId: true } }));
  }
  const byLine = new Map(acLines.map((line) => [line.id, line]));
  const findings = evaluateDeterministicFindings({ runId, candidates: fields,
    invoices: invoices.map((invoice) => ({ ...invoice, issuedAt: invoice.issuedAt.toISOString().slice(0, 10) })),
    cash: cashLines.map((line) => ({ lineId: line.id, approvedAmount: line.amount,
      paidAmount: source(sum(line.cashAllocations.map((allocation) => exact(allocation.amount)))),
      requestState: line.request.state })),
    lineage: invoiceLinks.map((link) => {
      const line = byLine.get(link.actualCostLineId);
      const version = line?.versions.find((item) => item.id === link.actualCostVersionId);
      const approval = version?.approvals.find((item) => item.id === link.approvalId);
      return { id: link.id, lineId: link.actualCostLineId, versionId: link.actualCostVersionId,
        currentVersionId: line?.versions.find((item) => item.version === line.currentVersion)?.id ?? null,
        approvalVersionId: approval ? version?.id ?? null : null,
        approvalAction: approval?.action ?? null };
    }),
    evidence: acLines.flatMap((line) => line.versions.map((version) => ({ versionId: version.id,
      evidenceCount: version.evidenceLinks.length, approved: version.state === "APPROVED" }))),
    modelFlags: fields.filter((field) => field.provenance === "MODEL" && Number(field.confidence) < 0.6)
      .map((field) => ({ candidateId: field.id, code: "LOW_CONFIDENCE" })),
  });
  if (fields.length === 0 && ["INCOMPLETE", "REFUSED", "FAILED"].includes(run.outcomeCode ?? run.status)) {
    findings.push({ kind: "MISSING_DATA", ruleCode: "UNREADABLE_RUN", ruleVersion: "phase15-finance-v1",
      targetKind: "RUN", targetId: runId, sourceSpanId: null });
  }
  const firstSource = run.sources[0]?.sourceRevision;
  const ownerId = firstSource ? await sourceUploader(projectId, firstSource.originKind, firstSource.originId,
    firstSource.createdById) : run.actorId;
  return prisma.$transaction(async (tx) => {
    let created = 0;
    for (const item of findings) {
      const prior = await tx.aiFinding.findFirst({ where: { runId, scopeKey: run.scopeKey,
        kind: item.kind, ruleCode: item.ruleCode, ruleVersion: item.ruleVersion,
        targetKind: item.targetKind, targetId: item.targetId } });
      if (prior) continue;
      await tx.aiFinding.create({ data: {
        runId, projectId, scopeKey: run.scopeKey, kind: item.kind, ruleCode: item.ruleCode,
        ruleVersion: item.ruleVersion, targetKind: item.targetKind, targetId: item.targetId,
        sourceSpanId: item.sourceSpanId, ownerId,
        route: routeForFinding(sourceKind, item.ruleCode), status: "OPEN",
      } });
      created++;
    }
    return { created, total: findings.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export type AiFindingView = Awaited<ReturnType<typeof listAiFindings>>[number];

export async function listAiFindings(actorId: string, projectId: string) {
  const { actor, project } = await requireAiProjectRead(actorId, projectId);
  const rows = await prisma.aiFinding.findMany({ where: { projectId }, orderBy: { createdAt: "desc" },
    take: 200, select: { id: true, runId: true, kind: true, ruleCode: true, ruleVersion: true,
      targetKind: true, targetId: true, sourceSpanId: true, ownerId: true, route: true,
      status: true, resolutionReason: true, resolvedById: true, resolvedAt: true, createdAt: true,
      run: { select: { sources: { select: { sourceRevision: { select: {
        filename: true, originKind: true, originVersion: true,
      } } } } } },
      sourceSpan: { select: { sourceRevisionId: true, pageNumber: true, sheetName: true,
        cellRange: true, xmlPath: true, textStart: true, textEnd: true } },
    } });
  const access = new Map<string, boolean>();
  const result = [];
  for (const row of rows) {
    if (!access.has(row.runId)) {
      try { await readAiRun(actorId, projectId, row.runId); access.set(row.runId, true); }
      catch (error) { if (!(error instanceof AiSourceNotFoundError)) throw error; access.set(row.runId, false); }
    }
    if (!access.get(row.runId)) continue;
    result.push({ ...row, canResolve: canResolveRoute(actor, project.ownerId, row),
      sourceName: row.run.sources[0]?.sourceRevision.filename ?? "Nguồn chứng từ",
      sourceKind: row.run.sources[0]?.sourceRevision.originKind ?? "DOCUMENT",
      sourceVersion: row.run.sources[0]?.sourceRevision.originVersion ?? "—",
      sourceSpan: row.sourceSpan });
  }
  return result;
}

export async function resolveAiFinding(actorId: string, projectId: string, findingId: string,
  decision: FindingResolution, rawReason: string) {
  if (!resolutions.has(decision) || typeof rawReason !== "string" || rawReason.trim().length < 3 || rawReason.length > 1000) {
    throw new Error("Cần chọn kết quả và nhập lý do ít nhất 3 ký tự.");
  }
  const { actor, project } = await requireAiProjectRead(actorId, projectId);
  return prisma.$transaction(async (tx) => {
    const finding = await tx.aiFinding.findFirst({ where: { id: findingId, projectId },
      select: { id: true, runId: true, scopeKey: true, ownerId: true, route: true,
        status: true, kind: true, ruleCode: true, targetKind: true, targetId: true } });
    if (!finding) throw new AiSourceNotFoundError();
    await readAiRun(actorId, projectId, finding.runId);
    const allowed = canResolveRoute(actor, project.ownerId, finding);
    if (!allowed) throw new AiSourceNotFoundError();
    if (finding.status !== "OPEN") throw new Error("Cảnh báo đã được xử lý. Tải lại hàng chờ.");
    const changed = await tx.aiFinding.updateMany({ where: { id: findingId, projectId, status: "OPEN" },
      data: { status: decision, resolutionReason: rawReason.trim(), resolvedById: actorId,
        resolvedAt: new Date() } });
    if (changed.count !== 1) throw new Error("Cảnh báo đã thay đổi. Tải lại hàng chờ.");
    await tx.aiReviewEvent.create({ data: { runId: finding.runId, scopeKey: finding.scopeKey,
      findingId, targetKind: "FINDING", targetId: findingId, action: decision,
      beforeValue: { status: "OPEN" }, afterValue: { status: decision },
      actorId, reason: rawReason.trim() } });
    return { findingId, status: decision };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
