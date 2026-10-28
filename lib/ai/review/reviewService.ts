import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { readAiRun } from "@/lib/ai/runs/aiRunService";
import { AiSourceNotFoundError, requireAiProjectRead } from "@/lib/ai/access/resolveAiReadScope";
import { prisma } from "@/lib/prisma";

export type AiReviewChoice = "ACCEPT_AI" | "CORRECT" | "MANUAL" | "REJECT";
export type AiApplyDecision = "KEEP_CURRENT" | "APPLY_REVIEWED";

export type ReviewedField = {
  id: string;
  fieldKey: string;
  reviewStatus: string;
  aiValue: string | null;
  correctedValue: string | null;
  manualValue: string | null;
  sourceSpanId: string | null;
};

export function prepareAiFieldDecisions(fields: readonly ReviewedField[], current: Record<string, string | null>) {
  return fields.map((field) => {
    const reviewedValue = field.reviewStatus === "CORRECT" ? field.correctedValue :
      field.reviewStatus === "MANUAL" ? field.manualValue :
      field.reviewStatus === "ACCEPT_AI" ? field.aiValue : null;
    return { candidateFieldId: field.id, fieldKey: field.fieldKey,
      currentValue: current[field.fieldKey] ?? null, reviewedValue,
      sourceSpanId: field.sourceSpanId, conflict: reviewedValue !== null &&
        reviewedValue !== (current[field.fieldKey] ?? null),
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

export type DocumentDraftKind = "PO" | "VAT";
const draftFields: Record<DocumentDraftKind, ReadonlySet<string>> = {
  PO: new Set(["poNumber", "poDate", "currency", "revenue", "clientName", "description"]),
  VAT: new Set(["invoiceNumber", "symbol", "issuedAt", "sellerTaxCode",
    "netAmount", "vatAmount", "grossAmount"]),
};

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

async function loadReviewedDraft(tx: Prisma.TransactionClient, actorId: string,
  projectId: string, runId: string, kind: DocumentDraftKind, draftId: string) {
  const run = await assertReviewActor(tx, actorId, projectId, runId);
  if (run.status !== "SUCCEEDED" || run.reviewStatus !== "COMPLETED") {
    throw new Error("Every candidate must be reviewed before application.");
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

export async function prepareAiApplyConflicts(actorId: string, projectId: string,
  runId: string, kind: DocumentDraftKind, draftId: string) {
  await readAiRun(actorId, projectId, runId);
  return prisma.$transaction(async (tx) => {
    const { draft, candidates, current } = await loadReviewedDraft(tx, actorId, projectId, runId, kind, draftId);
    return { targetKind: kind, targetId: draft.id, targetVersion: String(draft.version),
      fields: prepareAiFieldDecisions(candidates, current) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function applyAiReviewToDraft(actorId: string, projectId: string, runId: string,
  kind: DocumentDraftKind, draftId: string, command: {
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
    const decisionById = new Map(command.decisions.map((item) => [item.candidateFieldId, item.decision]));
    const fieldDecisions = candidates.map((candidate) => ({
      candidateFieldId: candidate.id, rowKey: candidate.rowKey, fieldKey: candidate.fieldKey,
      aiValue: candidate.aiValue, rawValue: candidate.rawValue,
      correctedValue: candidate.correctedValue, manualValue: candidate.manualValue,
      reviewStatus: candidate.reviewStatus, reviewedById: candidate.reviewedById,
      reviewedAt: candidate.reviewedAt?.toISOString() ?? null, reason: candidate.reason,
      sourceSpanId: candidate.sourceSpanId, currentValue: current[candidate.fieldKey] ?? null,
      reviewedValue: prepared.find((item) => item.candidateFieldId === candidate.id)?.reviewedValue ?? null,
      decision: decisionById.get(candidate.id) ?? "KEEP_CURRENT",
      finalValue: next[candidate.fieldKey] ?? null,
    }));
    const changed = await tx.documentIntakeDraft.updateMany({ where: {
      id: draftId, projectId, kind, createdById: actorId, status: "DRAFT", version: draft.version,
    }, data: { fields: next, version: { increment: 1 } } });
    if (changed.count !== 1) throw new Error("Draft changed concurrently.");
    return tx.aiApplicationReceipt.create({ data: {
      runId, scopeKey: run.scopeKey, targetKind: kind, targetId: draftId,
      targetVersionBefore: String(draft.version), targetVersionAfter: String(draft.version + 1),
      beforeHash: fieldHash(current), afterHash: fieldHash(next),
      fieldDecisions, actorId, idempotencyKey: command.idempotencyKey,
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
