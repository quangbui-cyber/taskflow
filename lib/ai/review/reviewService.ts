import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { readAiRun } from "@/lib/ai/runs/aiRunService";
import { AiSourceNotFoundError, requireAiProjectRead } from "@/lib/ai/access/resolveAiReadScope";
import { prisma } from "@/lib/prisma";
import { normalizePairedRows } from "@/lib/costflow/pairedDraft";
import type { FinanceData } from "@/lib/costflow/types";

export type AiReviewChoice = "ACCEPT_AI" | "CORRECT" | "MANUAL" | "REJECT";
export type AiApplyDecision = "KEEP_CURRENT" | "APPLY_REVIEWED";

export type ReviewedField = {
  id: string;
  rowKey?: string;
  fieldKey: string;
  reviewStatus: string;
  aiValue: string | null;
  correctedValue: string | null;
  manualValue: string | null;
  sourceSpanId: string | null;
  rawValue?: string | null;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
  reason?: string | null;
};

export function prepareAiFieldDecisions(fields: readonly ReviewedField[], current: Record<string, string | null>) {
  return fields.map((field) => {
    const currentKey = field.rowKey && field.rowKey !== "document" ? `${field.rowKey}:${field.fieldKey}` : field.fieldKey;
    const reviewedValue = field.reviewStatus === "CORRECT" ? field.correctedValue :
      field.reviewStatus === "MANUAL" ? field.manualValue :
      field.reviewStatus === "ACCEPT_AI" ? field.aiValue : null;
    return { candidateFieldId: field.id, fieldKey: field.fieldKey,
      ...(field.rowKey ? { rowKey: field.rowKey } : {}),
      currentValue: current[currentKey] ?? null, reviewedValue,
      sourceSpanId: field.sourceSpanId, conflict: reviewedValue !== null &&
        reviewedValue !== (current[currentKey] ?? null),
      defaultDecision: "KEEP_CURRENT" as const };
  });
}

export function resolveAiApplySelections(
  prepared: ReturnType<typeof prepareAiFieldDecisions>,
  selections: readonly { candidateFieldId: string; decision: AiApplyDecision }[],
) {
  if (new Set(selections.map((selection) => selection.candidateFieldId)).size !== selections.length) {
    throw new Error("Duplicate field decision.");
  }
  return selections.map((selection) => {
    if (!["KEEP_CURRENT", "APPLY_REVIEWED"].includes(selection.decision)) throw new Error("Invalid field decision.");
    const field = prepared.find((item) => item.candidateFieldId === selection.candidateFieldId);
    if (!field) throw new Error("Unknown field decision.");
    if (selection.decision === "APPLY_REVIEWED" && field.reviewedValue === null) {
      throw new Error("Rejected or unreviewed field cannot be applied.");
    }
    return { candidateFieldId: field.candidateFieldId, fieldKey: field.fieldKey,
      ...(field.rowKey ? { rowKey: field.rowKey } : {}),
      currentValue: field.currentValue, reviewedValue: field.reviewedValue,
      decision: selection.decision, sourceSpanId: field.sourceSpanId };
  }).filter((item) => item.decision === "APPLY_REVIEWED");
}

const criticalField = /(?:vendor|supplier|identity|tax|number|date|issued|amount|gross|net|vat|price|quantity|poIds|lineage|source)/i;
const moneyField = /(?:amount|gross|net|vat|price|quantity|revenue)/i;

export function validateAiFieldReview(input: {
  fieldKey: string;
  aiValue: string | null;
  choice: AiReviewChoice;
  value?: string;
  reason?: string;
}) {
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(input.fieldKey) ||
      !["ACCEPT_AI", "CORRECT", "MANUAL", "REJECT"].includes(input.choice)) {
    throw new Error("Invalid review choice.");
  }
  const reason = input.reason?.trim() ?? "";
  if (reason.length > 1000) throw new Error("Review reason is too long.");
  if (input.choice === "REJECT") return { choice: input.choice, value: null, reason };
  if (input.choice === "ACCEPT_AI") {
    if (input.aiValue === null) throw new Error("No extracted value to accept.");
    return { choice: input.choice, value: input.aiValue, reason };
  }
  const value = input.value?.trim() ?? "";
  if (!value || value.length > 5000) throw new Error("Reviewed value is required.");
  if (criticalField.test(input.fieldKey) && reason.length < 3) throw new Error("Critical field correction requires a reason.");
  if (moneyField.test(input.fieldKey) && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error("Canonical nonnegative decimal required.");
  }
  return { choice: input.choice, value, reason };
}

async function assertReviewActor(tx: Prisma.TransactionClient, actorId: string, projectId: string, runId: string) {
  const [actor, project, run] = await Promise.all([
    tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } }),
    tx.project.findUnique({ where: { id: projectId }, select: { ownerId: true,
      members: { where: { userId: actorId }, select: { userId: true } } } }),
    tx.aiRun.findFirst({ where: { id: runId, projectId }, select: { id: true, actorId: true,
      scopeKey: true, status: true, reviewStatus: true } }),
  ]);
  if (!actor?.isActive || !project || !run || run.actorId !== actorId ||
      (actor.role !== "ADMIN" && project.ownerId !== actorId && project.members.length === 0)) {
    throw new AiSourceNotFoundError();
  }
  return run;
}

export async function recordAiFieldReview(actorId: string, projectId: string, runId: string, input: {
  candidateFieldId: string; choice: AiReviewChoice; value?: string; reason?: string;
}) {
  await readAiRun(actorId, projectId, runId);
  return prisma.$transaction(async (tx) => {
    const run = await assertReviewActor(tx, actorId, projectId, runId);
    if (run.status !== "SUCCEEDED" || run.reviewStatus !== "PENDING") throw new Error("Review is closed.");
    const candidate = await tx.aiCandidateField.findFirst({ where: {
      id: input.candidateFieldId, runId, scopeKey: run.scopeKey,
    } });
    if (!candidate) throw new AiSourceNotFoundError();
    const checked = validateAiFieldReview({ fieldKey: candidate.fieldKey,
      aiValue: candidate.aiValue, choice: input.choice, value: input.value, reason: input.reason });
    await tx.aiCandidateField.update({ where: { id: candidate.id }, data: {
      reviewStatus: checked.choice, correctedValue: checked.choice === "CORRECT" ? checked.value : null,
      manualValue: checked.choice === "MANUAL" ? checked.value : null,
      reviewedById: actorId, reviewedAt: new Date(), reason: checked.reason,
    } });
    const event = await tx.aiReviewEvent.create({ data: {
      runId, scopeKey: run.scopeKey, candidateFieldId: candidate.id,
      targetKind: "FIELD", targetId: candidate.id, action: checked.choice,
      beforeValue: { aiValue: candidate.aiValue, rawValue: candidate.rawValue,
        correctedValue: candidate.correctedValue, manualValue: candidate.manualValue,
        reviewStatus: candidate.reviewStatus },
      afterValue: { selectedValue: checked.value, sourceSpanId: candidate.sourceSpanId,
        provenance: checked.choice === "MANUAL" ? "MANUAL" : candidate.provenance },
      actorId, reason: checked.reason,
    } });
    return { eventId: event.id, candidateFieldId: candidate.id, choice: checked.choice,
      selectedValue: checked.value };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function completeAiReview(actorId: string, projectId: string, runId: string) {
  await readAiRun(actorId, projectId, runId);
  return prisma.$transaction(async (tx) => {
    const run = await assertReviewActor(tx, actorId, projectId, runId);
    if (run.reviewStatus === "COMPLETED") return { completed: true, reused: true };
    if (run.status !== "SUCCEEDED") throw new Error("Run has no reviewable candidates.");
    const [total, pending] = await Promise.all([
      tx.aiCandidateField.count({ where: { runId } }),
      tx.aiCandidateField.count({ where: { runId, reviewStatus: "PENDING" } }),
    ]);
    if (!total || pending) throw new Error("Every field and row needs a review choice.");
    const changed = await tx.aiRun.updateMany({ where: { id: runId, reviewStatus: "PENDING" },
      data: { reviewStatus: "COMPLETED" } });
    if (changed.count !== 1) throw new Error("Review changed concurrently.");
    await tx.aiReviewEvent.create({ data: { runId, scopeKey: run.scopeKey,
      targetKind: "RUN", targetId: runId, action: "COMPLETE_REVIEW",
      afterValue: { fieldCount: total }, actorId, reason: "" } });
    return { completed: true, reused: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getAiReviewSnapshot(actorId: string, projectId: string, runId: string) {
  await readAiRun(actorId, projectId, runId);
  return prisma.$transaction(async (tx) => {
    const run = await assertReviewActor(tx, actorId, projectId, runId);
    const [fields, receipts] = await Promise.all([
      tx.aiCandidateField.findMany({ where: { runId, scopeKey: run.scopeKey },
        orderBy: [{ rowKey: "asc" }, { fieldKey: "asc" }],
        include: { sourceSpan: { select: { id: true, sourceRevisionId: true,
          pageNumber: true, sheetName: true, cellRange: true, xmlPath: true,
          textStart: true, textEnd: true, quote: true } } } }),
      tx.aiApplicationReceipt.findMany({ where: { runId, scopeKey: run.scopeKey },
        orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    return { runId, reviewStatus: run.reviewStatus, runStatus: run.status,
      fields: fields.map((field) => ({ id: field.id, rowKey: field.rowKey,
        fieldKey: field.fieldKey, aiValue: field.aiValue, rawValue: field.rawValue,
        correctedValue: field.correctedValue, manualValue: field.manualValue,
        provenance: field.provenance, confidence: field.confidence,
        reviewStatus: field.reviewStatus, reviewedById: field.reviewedById,
        reviewedAt: field.reviewedAt, reason: field.reason, sourceSpan: field.sourceSpan })),
      receipts: receipts.map((receipt) => ({ id: receipt.id, targetKind: receipt.targetKind,
        targetId: receipt.targetId, targetVersionBefore: receipt.targetVersionBefore,
        targetVersionAfter: receipt.targetVersionAfter, fieldDecisions: receipt.fieldDecisions,
        actorId: receipt.actorId, createdAt: receipt.createdAt })) };
  });
}

export type DocumentDraftKind = "PO" | "VAT";
export type AiDraftKind = DocumentDraftKind | "IC";
const draftFields: Record<DocumentDraftKind, ReadonlySet<string>> = {
  PO: new Set(["poNumber", "poDate", "currency", "revenue", "clientName", "description"]),
  VAT: new Set(["invoiceNumber", "symbol", "issuedAt", "sellerTaxCode",
    "netAmount", "vatAmount", "grossAmount"]),
};
const icDraftFields = new Set(["buy.quantity", "buy.days", "buy.unitPrice", "buy.vatPercent", "buy.notes"]);

function canonicalDraftFields(value: Prisma.JsonValue): Record<string, string | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid draft fields.");
  const fields: Record<string, string | null> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field !== null && typeof field !== "string") throw new Error("Invalid draft field value.");
    fields[key] = field;
  }
  return fields;
}

function fieldHash(fields: Record<string, string | null>) {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(
    Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)),
  ))).digest("hex");
}

export async function createDocumentIntakeDraft(actorId: string, projectId: string, kind: DocumentDraftKind) {
  if (kind !== "PO" && kind !== "VAT") throw new Error("Unsupported draft kind.");
  await requireAiProjectRead(actorId, projectId);
  return prisma.documentIntakeDraft.create({ data: { projectId, kind, createdById: actorId, fields: {} },
    select: { id: true, projectId: true, kind: true, status: true, version: true } });
}

export async function getDocumentIntakeDraft(actorId: string, projectId: string, draftId: string) {
  await requireAiProjectRead(actorId, projectId);
  const draft = await prisma.documentIntakeDraft.findFirst({ where: {
    id: draftId, projectId, createdById: actorId,
  }, select: { id: true, kind: true, status: true, version: true, fields: true,
    createdAt: true, updatedAt: true } });
  if (!draft) throw new AiSourceNotFoundError();
  return draft;
}

export async function listDocumentIntakeDrafts(actorId: string, projectId: string) {
  await requireAiProjectRead(actorId, projectId);
  return prisma.documentIntakeDraft.findMany({ where: { projectId, createdById: actorId },
    orderBy: { updatedAt: "desc" }, take: 30,
    select: { id: true, kind: true, status: true, version: true,
      createdAt: true, updatedAt: true } });
}

async function loadReviewedDraft(tx: Prisma.TransactionClient, actorId: string,
  projectId: string, runId: string, kind: DocumentDraftKind, draftId: string) {
  const run = await assertReviewActor(tx, actorId, projectId, runId);
  if (run.status !== "SUCCEEDED" || run.reviewStatus !== "COMPLETED") {
    throw new Error("Every candidate must be reviewed before application.");
  }
  const sourceKinds = await tx.aiRunSource.findMany({ where: { runId },
    select: { sourceRevision: { select: { originKind: true } } } });
  if (!sourceKinds.length || sourceKinds.some(({ sourceRevision }) => kind === "VAT" ?
      sourceRevision.originKind !== "VENDOR_INVOICE_FILE" :
      !["PROJECT_FILE", "COSTFLOW_PO"].includes(sourceRevision.originKind))) {
    throw new Error("Run source does not match target draft kind.");
  }
  const draft = await tx.documentIntakeDraft.findFirst({ where: {
    id: draftId, projectId, kind, createdById: actorId,
  } });
  if (!draft) throw new AiSourceNotFoundError();
  if (draft.status !== "DRAFT") throw new Error("Target draft is locked.");
  const candidates = await tx.aiCandidateField.findMany({ where: { runId, scopeKey: run.scopeKey },
    orderBy: [{ rowKey: "asc" }, { fieldKey: "asc" }] });
  if (!candidates.length || candidates.some((candidate) => candidate.reviewStatus === "PENDING" ||
      candidate.rowKey !== "document" || !draftFields[kind].has(candidate.fieldKey))) {
    throw new Error("Reviewed fields do not match this draft kind.");
  }
  return { run, draft, candidates, current: canonicalDraftFields(draft.fields) };
}

async function loadReviewedIcDraft(tx: Prisma.TransactionClient, actorId: string,
  projectId: string, runId: string, draftId: string) {
  const run = await assertReviewActor(tx, actorId, projectId, runId);
  if (run.status !== "SUCCEEDED" || run.reviewStatus !== "COMPLETED") {
    throw new Error("Every candidate must be reviewed before application.");
  }
  const sourceKinds = await tx.aiRunSource.findMany({ where: { runId },
    select: { sourceRevision: { select: { originKind: true } } } });
  if (sourceKinds.length !== 1 || sourceKinds[0].sourceRevision.originKind !== "COSTFLOW_IC") {
    throw new Error("Only an IC revision can propose IC draft fields.");
  }
  const workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId } });
  const data = workspace?.data as FinanceData | undefined;
  if (!workspace || !data || data.closed) throw new Error("IC workspace is closed.");
  const draft = data.quotationDrafts?.find((item) => item.id === draftId && item.createdBy === actorId &&
    (item.workspaceMode === "ic" || item.workspaceMode === "paired"));
  if (!draft) throw new AiSourceNotFoundError();
  if (draft.icRevisionId) {
    const revision = data.revisions.find((item) => item.id === draft.icRevisionId);
    const request = revision ? await tx.workflowRequest.findUnique({ where: { id: revision.requestId },
      select: { projectId: true, state: true, creatorId: true } }) : null;
    if (!revision || revision.effective || !request || request.projectId !== projectId ||
        request.state !== "DRAFT" || request.creatorId !== actorId) {
      throw new Error("IC revision is approved or locked.");
    }
  }
  const candidates = await tx.aiCandidateField.findMany({ where: { runId, scopeKey: run.scopeKey },
    orderBy: [{ rowKey: "asc" }, { fieldKey: "asc" }] });
  if (!candidates.length || candidates.some((candidate) => candidate.reviewStatus === "PENDING" ||
      !icDraftFields.has(candidate.fieldKey) || !draft.rows.some((row) => row.itemId === candidate.rowKey))) {
    throw new Error("Reviewed IC rows do not match this draft.");
  }
  const current: Record<string, string | null> = {};
  for (const candidate of candidates) {
    const row = draft.rows.find((item) => item.itemId === candidate.rowKey)!;
    const field = candidate.fieldKey.slice(4) as keyof typeof row.buy;
    const value = row.buy[field];
    if (typeof value !== "string") throw new Error("IC draft field is not textual.");
    current[`${candidate.rowKey}:${candidate.fieldKey}`] = value;
  }
  return { run, workspace, data, draft, candidates, current };
}

export async function prepareAiApplyConflicts(actorId: string, projectId: string,
  runId: string, kind: AiDraftKind, draftId: string) {
  await readAiRun(actorId, projectId, runId);
  return prisma.$transaction(async (tx) => {
    if (kind === "IC") {
      const { draft, candidates, current } = await loadReviewedIcDraft(tx, actorId, projectId, runId, draftId);
      return { targetKind: kind, targetId: draft.id, targetVersion: String(draft.version),
        fields: prepareAiFieldDecisions(candidates, current) };
    }
    const { draft, candidates, current } = await loadReviewedDraft(tx, actorId, projectId, runId, kind, draftId);
    return { targetKind: kind, targetId: draft.id, targetVersion: String(draft.version),
      fields: prepareAiFieldDecisions(candidates, current) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function applyAiReviewToDraft(actorId: string, projectId: string, runId: string,
  kind: AiDraftKind, draftId: string, command: {
    expectedVersion: string;
    idempotencyKey: string;
    decisions: readonly { candidateFieldId: string; decision: AiApplyDecision }[];
  }) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(command.idempotencyKey) ||
      !/^[1-9]\d*$/.test(command.expectedVersion) ||
      !Array.isArray(command.decisions)) throw new Error("Invalid apply request.");
  await readAiRun(actorId, projectId, runId);
  return prisma.$transaction(async (tx) => {
    const run = await assertReviewActor(tx, actorId, projectId, runId);
    if (run.status !== "SUCCEEDED" || run.reviewStatus !== "COMPLETED") {
      throw new Error("Review is not complete.");
    }
    const previousReceipt = await tx.aiApplicationReceipt.findUnique({
      where: { scopeKey_idempotencyKey: { scopeKey: run.scopeKey, idempotencyKey: command.idempotencyKey } },
    });
    if (previousReceipt) {
      if (previousReceipt.runId !== runId || previousReceipt.targetKind !== kind ||
          previousReceipt.targetId !== draftId || previousReceipt.actorId !== actorId) {
        throw new Error("Idempotency key belongs to another application.");
      }
      return previousReceipt;
    }
    if (kind === "IC") {
      const { workspace, data, draft, candidates, current } = await loadReviewedIcDraft(
        tx, actorId, projectId, runId, draftId,
      );
      if (String(draft.version) !== command.expectedVersion) throw new Error("Draft version changed; refresh conflicts.");
      const prepared = prepareAiFieldDecisions(candidates, current);
      const selected = resolveAiApplySelections(prepared, command.decisions);
      const nextData = structuredClone(data);
      const nextDraft = nextData.quotationDrafts!.find((item) => item.id === draftId)!;
      const after = { ...current };
      for (const selection of selected) {
        if (!selection.rowKey || selection.reviewedValue === null) throw new Error("Invalid IC row decision.");
        if (moneyField.test(selection.fieldKey) && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(selection.reviewedValue)) {
          throw new Error("Reviewed IC money must be canonical.");
        }
        const row = nextDraft.rows.find((item) => item.itemId === selection.rowKey);
        if (!row) throw new Error("IC row changed.");
        const field = selection.fieldKey.slice(4) as "quantity" | "days" | "unitPrice" | "vatPercent" | "notes";
        row.buy[field] = selection.reviewedValue;
        after[`${selection.rowKey}:${selection.fieldKey}`] = selection.reviewedValue;
      }
      normalizePairedRows(nextDraft.rows);
      nextDraft.version++;
      const changed = await tx.costFlowWorkspace.updateMany({ where: { projectId, version: workspace.version },
        data: { data: nextData as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      if (changed.count !== 1) throw new Error("IC workspace changed concurrently.");
      return tx.aiApplicationReceipt.create({ data: {
        runId, scopeKey: run.scopeKey, targetKind: "IC", targetId: draftId,
        targetVersionBefore: String(draft.version), targetVersionAfter: String(nextDraft.version),
        beforeHash: fieldHash(current), afterHash: fieldHash(after),
        fieldDecisions: { fields: buildReceiptFields(candidates, prepared, current, after, command.decisions),
          targetBefore: current, targetAfter: after }, actorId, idempotencyKey: command.idempotencyKey,
      } });
    }
    const { draft, candidates, current } = await loadReviewedDraft(tx, actorId, projectId, runId, kind, draftId);
    if (String(draft.version) !== command.expectedVersion) throw new Error("Draft version changed; refresh conflicts.");
    const prepared = prepareAiFieldDecisions(candidates, current);
    const selected = resolveAiApplySelections(prepared, command.decisions);
    const next = { ...current };
    for (const selection of selected) {
      if (selection.reviewedValue === null) throw new Error("Missing reviewed value.");
      if (moneyField.test(selection.fieldKey) && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(selection.reviewedValue)) {
        throw new Error("Reviewed money must be canonical before application.");
      }
      next[selection.fieldKey] = selection.reviewedValue;
    }
    const fieldDecisions = buildReceiptFields(candidates, prepared, current, next, command.decisions);
    const changed = await tx.documentIntakeDraft.updateMany({ where: {
      id: draftId, projectId, kind, createdById: actorId, status: "DRAFT", version: draft.version,
    }, data: { fields: next, version: { increment: 1 } } });
    if (changed.count !== 1) throw new Error("Draft changed concurrently.");
    return tx.aiApplicationReceipt.create({ data: {
      runId, scopeKey: run.scopeKey, targetKind: kind, targetId: draftId,
      targetVersionBefore: String(draft.version), targetVersionAfter: String(draft.version + 1),
      beforeHash: fieldHash(current), afterHash: fieldHash(next),
      fieldDecisions: { fields: fieldDecisions, targetBefore: current, targetAfter: next },
      actorId, idempotencyKey: command.idempotencyKey,
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function buildReceiptFields(candidates: readonly ReviewedField[],
  prepared: ReturnType<typeof prepareAiFieldDecisions>, current: Record<string, string | null>,
  next: Record<string, string | null>, decisions: readonly { candidateFieldId: string; decision: AiApplyDecision }[]) {
  const decisionById = new Map(decisions.map((item) => [item.candidateFieldId, item.decision]));
  return candidates.map((candidate) => {
    const key = candidate.rowKey && candidate.rowKey !== "document" ?
      `${candidate.rowKey}:${candidate.fieldKey}` : candidate.fieldKey;
    return { candidateFieldId: candidate.id, rowKey: candidate.rowKey, fieldKey: candidate.fieldKey,
      aiValue: candidate.aiValue, rawValue: candidate.rawValue ?? null,
      correctedValue: candidate.correctedValue,
      manualValue: candidate.manualValue, reviewStatus: candidate.reviewStatus,
      reviewedById: candidate.reviewedById ?? null,
      reviewedAt: candidate.reviewedAt?.toISOString() ?? null, reason: candidate.reason ?? null,
      sourceSpanId: candidate.sourceSpanId, currentValue: current[key] ?? null,
      reviewedValue: prepared.find((item) => item.candidateFieldId === candidate.id)?.reviewedValue ?? null,
      decision: decisionById.get(candidate.id) ?? "KEEP_CURRENT", finalValue: next[key] ?? null };
  });
}
