"use server";

import { getCurrentUser } from "@/lib/auth";
import { AiSourceNotFoundError } from "@/lib/ai/access/resolveAiReadScope";
import { evaluateAndPersistAiFindings, listAiFindings, resolveAiFinding as resolveFinding,
  type FindingResolution } from "@/lib/ai/risk/findingService";

export async function evaluateAiRunFindings(input: { projectId: string; runId: string }) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return evaluateAndPersistAiFindings(actor.id, input.projectId, input.runId);
}

export async function getAiFindings(input: { projectId: string }) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return listAiFindings(actor.id, input.projectId);
}

export async function resolveAiFinding(input: {
  projectId: string; findingId: string; decision: FindingResolution; reason: string;
}) {
  const actor = await getCurrentUser();
  if (!actor) throw new AiSourceNotFoundError();
  return resolveFinding(actor.id, input.projectId, input.findingId, input.decision, input.reason);
}
