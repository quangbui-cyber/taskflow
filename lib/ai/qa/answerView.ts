import type { CitedAnswer } from "./answer";

export function normalizeAssistantResponse(value: unknown): CitedAnswer | null {
  if (!value || typeof value !== "object") return null;
  const answer = value as CitedAnswer;
  if (!["OK", "CONFLICT", "INSUFFICIENT", "REFUSED", "INCOMPLETE"].includes(answer.status) ||
    !Array.isArray(answer.claims) || !Array.isArray(answer.sources) || !Array.isArray(answer.conflicts)) return null;
  if (answer.status !== "OK") return { ...answer, claims: [] };
  const sourceIds = new Set(answer.sources.map((source) => source.spanId));
  if (!answer.claims.length || answer.claims.some((claim) =>
    typeof claim.text !== "string" || !claim.text.trim() ||
    !Array.isArray(claim.citationSpanIds) || !claim.citationSpanIds.length ||
    claim.citationSpanIds.some((id) => !sourceIds.has(id)))) return null;
  return answer;
}
