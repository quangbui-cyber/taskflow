import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAiProjectRead } from "@/lib/ai/access/resolveAiReadScope";

export type RetrievalHit = {
  chunkId: string;
  spanId: string;
  sourceRevisionId: string;
  publicationId: string;
  publicationVersion: number;
  originKind: string;
  originId: string;
  originVersion: string;
  filename: string;
  text: string;
  score: number;
  historical: boolean;
  conflictKey: string;
  pageNumber: number | null;
  sheetName: string | null;
  cellRange: string | null;
  xmlPath: string | null;
  textStart: number | null;
  textEnd: number | null;
};

export type RetrievalScope = { actorId: string; projectId: string };

type QueryRow = Omit<RetrievalHit, "score" | "conflictKey"> & {
  rank: number;
  publicationStatus: string;
};

export const postgresRetrievalStore = {
  async retrieve(scope: RetrievalScope, query: string): Promise<RetrievalHit[]> {
    await requireAiProjectRead(scope.actorId, scope.projectId);
    const boundedQuery = [...new Set(query.toLocaleLowerCase("vi-VN").match(/[\p{L}\p{N}]{3,}/gu) ?? [])]
      .slice(0, 8).join(" | ");
    if (!boundedQuery) return [];
    const schema = new URL(process.env.DATABASE_URL ?? "").searchParams.get("schema") || "public";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid database schema.");
    const qualified = Prisma.raw(`"${schema}".`);
    // All authorization and authority predicates execute inside PostgreSQL before text is projected.
    const rows = await prisma.$queryRaw<QueryRow[]>(Prisma.sql`
      SELECT k.id AS "chunkId", s.id AS "spanId", r.id AS "sourceRevisionId",
        p.id AS "publicationId", p."publicationVersion", r."originKind", r."originId",
        r."originVersion", r.filename, k."normalizedText" AS text,
        ts_rank_cd(to_tsvector('simple', k."normalizedText"), to_tsquery('simple', ${boundedQuery}))::float8 AS rank,
        (EXISTS (SELECT 1 FROM ${qualified}"AiKnowledgePublication" newer
          WHERE newer."sourceRevisionId" = p."sourceRevisionId"
            AND newer."publicationVersion" > p."publicationVersion"
            AND newer.status IN ('RECORD_CONFIRMED', 'PUBLISHED'))
         OR EXISTS (SELECT 1 FROM ${qualified}"AiSourceRevision" newer_source
           WHERE newer_source."originKind" = r."originKind"
             AND newer_source."originId" = r."originId"
             AND newer_source."scopeKey" = r."scopeKey"
             AND newer_source."authorityStatus" = 'CONFIRMED'
             AND (newer_source."createdAt", newer_source.id) > (r."createdAt", r.id))) AS historical,
        p.status AS "publicationStatus", s."pageNumber", s."sheetName", s."cellRange",
        s."xmlPath", s."textStart", s."textEnd"
      FROM ${qualified}"AiKnowledgeChunk" k
      JOIN ${qualified}"AiKnowledgePublication" p ON p.id = k."publicationId" AND p."scopeKey" = k."scopeKey"
      JOIN ${qualified}"AiSourceRevision" r ON r.id = p."sourceRevisionId" AND r."scopeKey" = p."scopeKey"
      JOIN ${qualified}"AiSourceSpan" s ON s.id = k."sourceSpanId" AND s."scopeKey" = k."scopeKey"
      WHERE r."authorityStatus" = 'CONFIRMED'
        AND (
          (r."projectId" = ${scope.projectId} AND r."scopeKey" = ${`PROJECT:${scope.projectId}`}
            AND r."originKind" IN ('COSTFLOW_PO','COSTFLOW_IC','FINANCE_SHEET',
              'VENDOR_INVOICE_FILE','COSTFLOW_EVIDENCE','EXCEL_INTAKE_SOURCE')
            AND p.status = 'RECORD_CONFIRMED')
          OR (r."projectId" IS NULL AND r."scopeKey" = 'GLOBAL'
            AND r."originKind" IN ('SOP','POLICY') AND p.status = 'PUBLISHED'
            AND (p."effectiveFrom" IS NULL OR p."effectiveFrom" <= now())
            AND (p."effectiveTo" IS NULL OR p."effectiveTo" > now()))
        )
        AND to_tsvector('simple', k."normalizedText") @@ to_tsquery('simple', ${boundedQuery})
      ORDER BY rank DESC, r.id, s.id, k.id
      LIMIT 6
    `);
    return rows.map((row) => ({ ...row, score: row.rank,
      conflictKey: `${row.originKind}:${row.originId}` }));
  },
  async retrievePublishedGlobal(actorId: string, query: string): Promise<RetrievalHit[]> {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { isActive: true } });
    if (!actor?.isActive) return [];
    const words = [...new Set(query.toLocaleLowerCase("vi-VN").match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 8);
    if (words.length === 0) return [];
    const now = new Date();
    const rows = await prisma.aiKnowledgeChunk.findMany({ where: {
      OR: words.map((word) => ({ normalizedText: { contains: word, mode: "insensitive" as const } })),
      publication: { scopeKey: "GLOBAL", status: "PUBLISHED",
        AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
        sourceRevision: { projectId: null, scopeKey: "GLOBAL", authorityStatus: "CONFIRMED",
          originKind: { in: ["SOP", "POLICY"] } } },
    }, orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, normalizedText: true, publicationId: true, sourceSpanId: true,
      publication: { select: { publicationVersion: true, sourceRevision: { select: {
        id: true, originKind: true, originId: true, originVersion: true, filename: true,
      } } } },
      sourceSpan: { select: { pageNumber: true, sheetName: true, cellRange: true,
        xmlPath: true, textStart: true, textEnd: true } } } });
    return rows.map((row) => ({ chunkId: row.id, spanId: row.sourceSpanId,
      sourceRevisionId: row.publication.sourceRevision.id, publicationId: row.publicationId,
      publicationVersion: row.publication.publicationVersion,
      originKind: row.publication.sourceRevision.originKind,
      originId: row.publication.sourceRevision.originId,
      originVersion: row.publication.sourceRevision.originVersion,
      filename: row.publication.sourceRevision.filename,
      text: row.normalizedText, score: words.filter((word) => row.normalizedText.toLocaleLowerCase("vi-VN").includes(word)).length,
      historical: false, conflictKey: `${row.publication.sourceRevision.originKind}:${row.publication.sourceRevision.originId}`,
      pageNumber: row.sourceSpan.pageNumber, sheetName: row.sourceSpan.sheetName,
      cellRange: row.sourceSpan.cellRange, xmlPath: row.sourceSpan.xmlPath,
      textStart: row.sourceSpan.textStart, textEnd: row.sourceSpan.textEnd,
    })).sort((a, b) => b.score - a.score).slice(0, 6);
  },
};
