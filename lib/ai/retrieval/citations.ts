import "server-only";

import { prisma } from "@/lib/prisma";
import { AiSourceNotFoundError, requireAiProjectRead } from "@/lib/ai/access/resolveAiReadScope";

export async function openAiCitation(actorId: string, spanId: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(spanId)) throw new AiSourceNotFoundError();
  const span = await prisma.aiSourceSpan.findUnique({
    where: { id: spanId },
    select: { id: true, pageNumber: true, sheetName: true, cellRange: true, xmlPath: true,
      textStart: true, textEnd: true, quote: true, sourceRevision: {
        select: { id: true, projectId: true, scopeKey: true, originKind: true, originId: true,
          originVersion: true, authorityStatus: true },
      }, knowledgeChunks: { select: { publication: {
        select: { status: true, effectiveFrom: true, effectiveTo: true },
      } } } },
  });
  if (!span || span.sourceRevision.authorityStatus !== "CONFIRMED") throw new AiSourceNotFoundError();
  const source = span.sourceRevision;
  if (source.projectId) await requireAiProjectRead(actorId, source.projectId);
  else {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { isActive: true } });
    if (!actor?.isActive || source.scopeKey !== "GLOBAL") throw new AiSourceNotFoundError();
  }
  const now = new Date();
  const allowed = span.knowledgeChunks.some(({ publication }) => source.projectId ?
    publication.status === "RECORD_CONFIRMED" :
    publication.status === "PUBLISHED" &&
      (!publication.effectiveFrom || publication.effectiveFrom <= now) &&
      (!publication.effectiveTo || publication.effectiveTo > now));
  if (!allowed) throw new AiSourceNotFoundError();
  return { spanId: span.id, sourceRevisionId: source.id, originKind: source.originKind,
    originId: source.originId, originVersion: source.originVersion,
    locator: { pageNumber: span.pageNumber, sheetName: span.sheetName,
      cellRange: span.cellRange, xmlPath: span.xmlPath, textStart: span.textStart,
      textEnd: span.textEnd }, quote: span.quote };
}
