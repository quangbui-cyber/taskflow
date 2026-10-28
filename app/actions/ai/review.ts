"use server";

import { getCurrentUser } from "@/lib/auth";
import { AiSourceNotFoundError } from "@/lib/ai/access/resolveAiReadScope";
import {
  completeAiReview as completeReview,
  recordAiFieldReview as recordFieldReview,
  type AiReviewChoice,
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
