"use server";

import { getCurrentUser } from "@/lib/auth";
import { AiSourceNotFoundError } from "@/lib/ai/access/resolveAiReadScope";
import { extractAndPersistDocumentRun } from "@/lib/ai/extraction/documentExtraction";
import { loadAiConfig } from "@/lib/ai/config";
import { OpenAiGenerationModel } from "@/lib/ai/providers/openai";
import {
  applyAiReviewToDraft as applyReviewToDraft,
  completeAiReview as completeReview,
  createDocumentIntakeDraft as createIntakeDraft,
  getDocumentIntakeDraft as readIntakeDraft,
  getAiReviewSnapshot as readReviewSnapshot,
  listDocumentIntakeDrafts as listIntakeDrafts,
  prepareAiApplyConflicts as prepareApplyConflicts,
  recordAiFieldReview as recordFieldReview,
  type AiApplyDecision,
  type AiDraftKind,
  type AiReviewChoice,
  type DocumentDraftKind,
} from "@/lib/ai/review/reviewService";

export async function executeAiDocumentRun(input: { projectId: string; runId: string }) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  const config = loadAiConfig();
  if (!config.enabled) throw new Error("AI analysis is unavailable.");
  return extractAndPersistDocumentRun(actor.id, input.projectId, input.runId,
    new OpenAiGenerationModel(config));
}

export async function getAiReviewSnapshot(input: { projectId: string; runId: string }) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return readReviewSnapshot(actor.id, input.projectId, input.runId);
}

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

export async function getDocumentIntakeDraft(input: { projectId: string; draftId: string }) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return readIntakeDraft(actor.id, input.projectId, input.draftId);
}

export async function listDocumentIntakeDrafts(input: { projectId: string }) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return listIntakeDrafts(actor.id, input.projectId);
}

export async function prepareAiApplyConflicts(input: {
  projectId: string; runId: string; kind: AiDraftKind; draftId: string;
}) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return prepareApplyConflicts(actor.id, input.projectId, input.runId, input.kind, input.draftId);
}

export async function applyAiReviewToDraft(input: {
  projectId: string; runId: string; kind: AiDraftKind; draftId: string;
  expectedVersion: string; idempotencyKey: string;
  decisions: { candidateFieldId: string; decision: AiApplyDecision }[];
}) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return applyReviewToDraft(actor.id, input.projectId, input.runId, input.kind, input.draftId, input);
}
