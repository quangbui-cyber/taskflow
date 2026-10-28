import "server-only";

import { prisma } from "@/lib/prisma";
import { AiSourceNotFoundError, requireAiProjectRead } from "@/lib/ai/access/resolveAiReadScope";
import { postgresRetrievalStore, type RetrievalHit } from "@/lib/ai/retrieval/postgresRetrievalStore";

export type AssistantContext = { kind: "project"; projectId: string } | { kind: "global" };
export type AnswerStatus = "OK" | "CONFLICT" | "INSUFFICIENT" | "REFUSED" | "INCOMPLETE";
export type AnswerSource = Pick<RetrievalHit, "spanId" | "sourceRevisionId" | "originKind" | "originId" | "originVersion" | "filename" | "historical" | "pageNumber" | "sheetName" | "cellRange" | "xmlPath" | "textStart" | "textEnd">;
export type CitedAnswer = { status: AnswerStatus; claims: { text: string; citationSpanIds: string[] }[];
  sources: AnswerSource[]; conflicts: AnswerSource[]; missingEvidence: string | null; confirmingRole: string | null };

const DEFAULT_ROLE = "Admin/người phụ trách nội dung được chỉ định";
const empty = (status: AnswerStatus, missingEvidence: string | null = null): CitedAnswer =>
  ({ status, claims: [], sources: [], conflicts: [], missingEvidence, confirmingRole: DEFAULT_ROLE });
const sourceOf = (hit: RetrievalHit): AnswerSource => ({ spanId: hit.spanId,
  sourceRevisionId: hit.sourceRevisionId, originKind: hit.originKind, originId: hit.originId,
  originVersion: hit.originVersion, filename: hit.filename, historical: hit.historical,
  pageNumber: hit.pageNumber, sheetName: hit.sheetName, cellRange: hit.cellRange,
  xmlPath: hit.xmlPath, textStart: hit.textStart, textEnd: hit.textEnd });

// Only literal excerpts from freshly authorized spans can become claims. Model output is never trusted here.
export function validateCitedAnswer(answer: CitedAnswer, hits: readonly RetrievalHit[]): CitedAnswer {
  if (answer.status !== "OK") return { ...answer, claims: [] };
  const bySpan = new Map(hits.map((hit) => [hit.spanId, hit]));
  for (const claim of answer.claims) {
    if (!claim.text.trim() || !claim.citationSpanIds.length || claim.text.length > 500 ||
      claim.citationSpanIds.some((id) => !bySpan.get(id)?.text.includes(claim.text))) {
      return empty("INCOMPLETE", "Dẫn nguồn chưa khớp với nội dung được phép xem.");
    }
  }
  return answer.claims.length ? answer : empty("INCOMPLETE", "Không có nội dung đủ căn cứ.");
}

function isUnsafe(question: string) {
  return /(?:bỏ qua|ignore|tiết lộ|reveal|liệt kê tất cả|list all).{0,70}(?:hướng dẫn|instruction|quyền|permission|project|dự án|bí mật|secret)/iu.test(question);
}

export async function answerAuthorizedQuestion({ actorId, context, question, signal }: {
  actorId: string; context: AssistantContext; question: string; signal?: AbortSignal;
}): Promise<CitedAnswer> {
  if (signal?.aborted) return empty("INCOMPLETE", "Yêu cầu đã bị hủy.");
  const normalized = question.trim().slice(0, 500);
  if (!normalized || question.length > 500) return empty("INCOMPLETE", "Câu hỏi phải dài từ 1 đến 500 ký tự.");
  if (isUnsafe(normalized)) return empty("REFUSED");
  let hits: RetrievalHit[];
  if (context.kind === "project") {
    await requireAiProjectRead(actorId, context.projectId);
    hits = await postgresRetrievalStore.retrieve({ actorId, projectId: context.projectId }, normalized);
  } else {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { isActive: true, role: true } });
    if (!actor?.isActive) throw new AiSourceNotFoundError();
    const projects = await prisma.project.findMany({ where: actor.role === "ADMIN" ? {} :
      { OR: [{ ownerId: actorId }, { members: { some: { userId: actorId } } }] },
      select: { id: true } });
    const groups: RetrievalHit[][] = [await postgresRetrievalStore.retrievePublishedGlobal(actorId, normalized)];
    for (const project of projects) {
      if (signal?.aborted) return empty("INCOMPLETE", "Yêu cầu đã bị hủy.");
      groups.push(await postgresRetrievalStore.retrieve({ actorId, projectId: project.id }, normalized));
    }
    hits = groups.flat().sort((a, b) => b.score - a.score).slice(0, 6);
  }
  if (signal?.aborted) return empty("INCOMPLETE", "Yêu cầu đã bị hủy.");
  // Instructions embedded in a source are data, never answer material.
  hits = hits.filter((hit) => !/(?:ignore|bỏ qua|system prompt|developer instruction|tiết lộ bí mật)/iu.test(hit.text));
  if (!hits.length) return empty("INSUFFICIENT", "Không tìm thấy nguồn phù hợp trong phạm vi hiện tại.");
  // Multiple published versions of one business object require human reconciliation.
  const byOrigin = new Map<string, RetrievalHit[]>();
  for (const hit of hits) byOrigin.set(hit.conflictKey, [...(byOrigin.get(hit.conflictKey) ?? []), hit]);
  const conflicting = [...byOrigin.values()].filter((group) =>
    new Set(group.map((hit) => hit.sourceRevisionId)).size > 1 &&
    new Set(group.map((hit) => hit.text.trim())).size > 1).flat();
  if (conflicting.length) return { ...empty("CONFLICT"), sources: hits.map(sourceOf),
    conflicts: conflicting.map(sourceOf) };
  const current = hits.filter((hit) => !hit.historical);
  if (!current.length) return { ...empty("INSUFFICIENT", "Chỉ tìm thấy phiên bản lịch sử."),
    sources: hits.map(sourceOf) };
  const claims = current.slice(0, 3).map((hit) => ({ text: hit.text.trim().slice(0, 500),
    citationSpanIds: [hit.spanId] }));
  return validateCitedAnswer({ status: "OK", claims, sources: current.slice(0, 3).map(sourceOf),
    conflicts: [], missingEvidence: null, confirmingRole: null }, current);
}
