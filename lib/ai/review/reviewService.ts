import "server-only";

import { Prisma } from "@prisma/client";
import { readAiRun } from "@/lib/ai/runs/aiRunService";
import { AiSourceNotFoundError } from "@/lib/ai/access/resolveAiReadScope";
import { prisma } from "@/lib/prisma";

export type AiReviewChoice = "ACCEPT_AI" | "CORRECT" | "MANUAL" | "REJECT";

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
