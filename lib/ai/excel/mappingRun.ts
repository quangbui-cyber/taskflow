import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AiSourceNotFoundError, requireAiProjectRead } from "@/lib/ai/access/resolveAiReadScope";
import { readAiRun } from "@/lib/ai/runs/aiRunService";
import type { GenerationModel } from "@/lib/ai/providers/types";
import { prisma } from "@/lib/prisma";
import { EXCEL_MASK_POLICY_VERSION } from "./masking";
import { proposeExcelMapping, validateExcelMapping, type ExcelMappingProposal, type ReviewedExcelMapping } from "./mapping";
import type { WorkbookInventory } from "./workbookInventory";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export async function executeExcelMappingRun(actorId: string, projectId: string, runId: string,
  workbookBytes: Uint8Array, inventory: WorkbookInventory, model: GenerationModel) {
  await readAiRun(actorId, projectId, runId);
  const run = await prisma.aiRun.findFirst({ where: { id: runId, projectId, actorId },
    include: { sources: { include: { sourceRevision: true } }, candidateFields: { where: { rowKey: "mapping", fieldKey: "structure" } } } });
  if (!run || run.runType !== "EXCEL_STRUCTURE" || run.sources.length !== 1 ||
      run.sources[0].sourceRevision.originKind !== "PROJECT_FILE" ||
      run.sources[0].sourceRevision.sha256 !== digest(workbookBytes)) throw new AiSourceNotFoundError();
  const currentFile = await prisma.projectFile.findFirst({ where: { id: run.sources[0].sourceRevision.originId, projectId }, select: { data: true } });
  if (!currentFile?.data || digest(currentFile.data) !== digest(workbookBytes)) throw new AiSourceNotFoundError();
  if (run.status === "SUCCEEDED") {
    const value = run.candidateFields[0]?.aiValue;
    if (!value) throw new AiSourceNotFoundError();
    const proposal = JSON.parse(value) as ExcelMappingProposal;
    const { tier } = validateExcelMapping(inventory, proposal);
    return { status: "PROPOSED" as const, proposal, tier, providerRequestId: run.providerRequestId, runId, reused: true };
  }
  if (run.status !== "READY" || run.cancelledAt || !run.timeoutAt || run.timeoutAt.getTime() <= Date.now()) throw new AiSourceNotFoundError();
  const claimed = await prisma.aiRun.updateMany({ where: { id: runId, status: "READY", cancelledAt: null }, data: { status: "RUNNING" } });
  if (claimed.count !== 1) throw new AiSourceNotFoundError();
  const suggestion = await proposeExcelMapping(inventory, model, AbortSignal.timeout(Math.max(1, run.timeoutAt.getTime() - Date.now())));
  const contentHash = digest(`${inventory.fingerprint}:${EXCEL_MASK_POLICY_VERSION}`);
  await prisma.$transaction(async tx => {
    const active = await tx.aiRun.findFirst({ where: { id: runId, status: "RUNNING", cancelledAt: null }, select: { id: true } });
    if (!active) throw new AiSourceNotFoundError();
    if (suggestion.proposal) {
      const span = await tx.aiSourceSpan.upsert({ where: { sourceRevisionId_contentHash: { sourceRevisionId: run.sources[0].sourceRevisionId, contentHash } },
        create: { sourceRevisionId: run.sources[0].sourceRevisionId, scopeKey: run.scopeKey, spanKind: "CELL",
          sheetName: suggestion.proposal.sheet, cellRange: suggestion.proposal.range,
          quote: "Masked workbook structure", normalizedText: JSON.stringify({ policyVersion: EXCEL_MASK_POLICY_VERSION,
            fingerprint: inventory.fingerprint, tokenCounts: suggestion.tokenCounts }), contentHash }, update: {} });
      await tx.aiCandidateField.create({ data: { runId, scopeKey: run.scopeKey,
        rowKey: "mapping", fieldKey: "structure", aiValue: JSON.stringify(suggestion.proposal), rawValue: null,
        provenance: "MODEL_COORDINATES", confidence: String(suggestion.proposal.confidence), sourceSpanId: span.id } });
    }
    await tx.aiRun.update({ where: { id: runId }, data: { status: suggestion.proposal ? "SUCCEEDED" : "FAILED",
      outcomeCode: suggestion.proposal ? "MAPPED" : "MANUAL_FALLBACK", failureCode: suggestion.proposal ? null : "INVALID_SCHEMA",
      providerRequestId: suggestion.providerRequestId, completedAt: new Date() } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { ...suggestion, runId, reused: false };
}

export async function recordPriorExcelMappingRun(actorId: string, projectId: string, runId: string,
  workbookBytes: Uint8Array, inventory: WorkbookInventory, mapping: ReviewedExcelMapping) {
  if (!mapping.adapterId || mapping.runId) throw new AiSourceNotFoundError();
  const adapter = await prisma.aiMappingAdapter.findFirst({ where: { id: mapping.adapterId, projectId,
    structureFingerprint: inventory.fingerprint, status: "ACTIVE" }, select: { id: true } });
  if (!adapter) throw new AiSourceNotFoundError();
  validateExcelMapping(inventory, mapping);
  await readAiRun(actorId, projectId, runId);
  const run = await prisma.aiRun.findFirst({ where: { id: runId, projectId, actorId, runType: "EXCEL_STRUCTURE", status: "READY" },
    include: { sources: { include: { sourceRevision: true } } } });
  if (!run || run.sources.length !== 1 || run.sources[0].sourceRevision.originKind !== "PROJECT_FILE" ||
      run.sources[0].sourceRevision.sha256 !== digest(workbookBytes)) throw new AiSourceNotFoundError();
  const currentFile = await prisma.projectFile.findFirst({ where: { id: run.sources[0].sourceRevision.originId, projectId }, select: { data: true } });
  if (!currentFile?.data || digest(currentFile.data) !== digest(workbookBytes)) throw new AiSourceNotFoundError();
  const claimed = await prisma.aiRun.updateMany({ where: { id: runId, status: "READY", cancelledAt: null }, data: { status: "RUNNING" } });
  if (claimed.count !== 1) throw new AiSourceNotFoundError();
  const proposal: ExcelMappingProposal = { sheet: mapping.sheet, range: mapping.range, headerRow: mapping.headerRow,
    kind: mapping.kind, columns: mapping.columns, rows: mapping.rows, confidence: mapping.confidence,
    additional: mapping.additional };
  const contentHash = digest(`${inventory.fingerprint}:${mapping.adapterId}:${runId}`);
  await prisma.$transaction(async tx => {
    const span = await tx.aiSourceSpan.create({ data: { sourceRevisionId: run.sources[0].sourceRevisionId, scopeKey: run.scopeKey,
      spanKind: "CELL", sheetName: mapping.sheet, cellRange: mapping.range,
      quote: "Previously confirmed mapping reviewed", normalizedText: JSON.stringify({ policyVersion: EXCEL_MASK_POLICY_VERSION,
        fingerprint: inventory.fingerprint, priorAdapterId: mapping.adapterId }), contentHash } });
    await tx.aiCandidateField.create({ data: { runId, scopeKey: run.scopeKey, rowKey: "mapping", fieldKey: "structure",
      aiValue: JSON.stringify(proposal), rawValue: null, provenance: "PRIOR_ADAPTER_REVIEWED",
      confidence: String(mapping.confidence), sourceSpanId: span.id } });
    await tx.aiRun.update({ where: { id: runId }, data: { status: "SUCCEEDED", outcomeCode: "MAPPED_FROM_PRIOR", completedAt: new Date() } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return runId;
}

export async function verifyReviewedExcelMappingRun(actorId: string, projectId: string,
  workbookBytes: Uint8Array, inventory: WorkbookInventory, mapping: ReviewedExcelMapping) {
  if (mapping.adapterId) {
    await requireAiProjectRead(actorId, projectId);
    const adapter = await prisma.aiMappingAdapter.findFirst({ where: { id: mapping.adapterId, projectId,
      structureFingerprint: inventory.fingerprint, status: "ACTIVE" }, select: { id: true } });
    if (!adapter) throw new AiSourceNotFoundError();
  }
  if (!mapping.runId) return null;
  await readAiRun(actorId, projectId, mapping.runId);
  const run = await prisma.aiRun.findFirst({ where: { id: mapping.runId, projectId, actorId, runType: "EXCEL_STRUCTURE", status: "SUCCEEDED" },
    include: { sources: { include: { sourceRevision: true } }, candidateFields: { where: { rowKey: "mapping", fieldKey: "structure" } } } });
  if (!run || run.sources.length !== 1 || run.sources[0].sourceRevision.sha256 !== digest(workbookBytes) || !run.candidateFields[0]) throw new AiSourceNotFoundError();
  const currentFile = await prisma.projectFile.findFirst({ where: { id: run.sources[0].sourceRevision.originId, projectId }, select: { data: true } });
  if (!currentFile?.data || digest(currentFile.data) !== digest(workbookBytes)) throw new AiSourceNotFoundError();
  validateExcelMapping(inventory, mapping);
  return run;
}

export async function recordReviewedExcelMapping(actorId: string, projectId: string, previewSessionId: string,
  workbookBytes: Uint8Array, inventory: WorkbookInventory, mapping: ReviewedExcelMapping) {
  const run = await verifyReviewedExcelMappingRun(actorId, projectId, workbookBytes, inventory, mapping);
  if (!run) return;
  await prisma.aiReviewEvent.create({ data: { runId: run.id, scopeKey: run.scopeKey,
    candidateFieldId: run.candidateFields[0].id, targetKind: "EXCEL_INTAKE_PREVIEW", targetId: previewSessionId,
    action: "REVIEW_MAPPING", beforeValue: { proposal: run.candidateFields[0].aiValue ?? "" },
    afterValue: { mapping: JSON.stringify(mapping) }, actorId, reason: "Explicit workbook mapping review" } });
}

export async function listPriorExcelMappings(actorId: string, projectId: string, inventory: WorkbookInventory) {
  await requireAiProjectRead(actorId, projectId);
  const adapters = await prisma.aiMappingAdapter.findMany({ where: { projectId,
    structureFingerprint: inventory.fingerprint, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 5,
    select: { id: true, adapterVersion: true, mapping: true, confirmedRunId: true, createdAt: true } });
  return adapters.map(adapter => ({ id: adapter.id, label: "Đã từng dùng mapping này", adapterVersion: adapter.adapterVersion,
    proposal: adapter.mapping, confirmedRunId: adapter.confirmedRunId, createdAt: adapter.createdAt.toISOString(),
    requiresReview: true }));
}
