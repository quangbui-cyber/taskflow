"use server";

import { getCurrentUser } from "@/lib/auth";
import { AiSourceNotFoundError } from "@/lib/ai/access/resolveAiReadScope";
import {
  applyAiReviewToDraft as applyReviewToDraft,
  completeAiReview as completeReview,
  createDocumentIntakeDraft as createIntakeDraft,
  prepareAiApplyConflicts as prepareApplyConflicts,
  recordAiFieldReview as recordFieldReview,
  type AiApplyDecision,
  type AiReviewChoice,
  type DocumentDraftKind,
} from "@/lib/ai/review/reviewService";

export async function recordAiFieldReview(input: {
  projectId: string;
  runId: string;
  candidateFieldId: string;
  choice: AiReviewChoice;
  value?: string;
  reason?: string;
}) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return recordFieldReview(actor.id, input.projectId, input.runId, input);
}

export async function completeAiReview(input: { projectId: string; runId: string }) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return completeReview(actor.id, input.projectId, input.runId);
}

export async function createDocumentIntakeDraft(input: { projectId: string; kind: DocumentDraftKind }) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return createIntakeDraft(actor.id, input.projectId, input.kind);
}

export async function prepareAiApplyConflicts(input: {
  projectId: string; runId: string; kind: DocumentDraftKind; draftId: string;
}) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return prepareApplyConflicts(actor.id, input.projectId, input.runId, input.kind, input.draftId);
}

export async function applyAiReviewToDraft(input: {
  projectId: string; runId: string; kind: DocumentDraftKind; draftId: string;
  expectedVersion: string; idempotencyKey: string;
  decisions: { candidateFieldId: string; decision: AiApplyDecision }[];
}) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return applyReviewToDraft(actor.id, input.projectId, input.runId, input.kind, input.draftId, input);
}
