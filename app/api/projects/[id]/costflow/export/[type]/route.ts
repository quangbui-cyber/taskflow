import { Prisma } from "@prisma/client";
import { getCurrentUser, getMembership } from "@/lib/auth";
import { buildSettlementExportWorkbook, resolveSealedExportProjection, type SettlementExportFamily } from "@/lib/costflow/export";
import { finalizeSettlementExportArtifact, reserveSettlementExportArtifact } from "@/lib/costflow/settlementSecurity";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAMILY_BY_PATH: Readonly<Record<string, SettlementExportFamily>> = {
  quotation: "QUOTATION",
  "customer-acceptance": "CUSTOMER_ACCEPTANCE",
  dntu: "DNTU",
  dntt: "DNTT",
  dnhtu: "DNHTU",
  "project-settlement": "PROJECT_SETTLEMENT",
};

function response(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request, context: { params: Promise<{ id: string; type: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return response("Unauthorized", 401);
  const { id: projectId, type } = await context.params;
  const family = FAMILY_BY_PATH[type.toLowerCase()];
  if (!family) return response("Loại chứng từ XLSX không hợp lệ.", 404);
  const search = new URL(request.url).searchParams;
  const sourceKind = search.get("sourceKind")?.trim() ?? "";
  const sourceId = search.get("sourceId")?.trim() ?? search.get("versionId")?.trim() ?? "";
  const sourceVersion = Number(search.get("sourceVersion"));
  if (!sourceKind || !sourceId || !Number.isSafeInteger(sourceVersion) || sourceVersion < 1) {
    return response("Thiếu exact sourceKind/sourceId/sourceVersion đã được seal.", 400);
  }
  const membership = actor.role === "ADMIN" ? null : await getMembership(projectId, actor.id);
  if (actor.role !== "ADMIN" && !membership) return response("Forbidden", 403);

  try {
    const result = await prisma.$transaction(async tx => {
      const resolved = await resolveSealedExportProjection(tx, { projectId, family, sourceKind, sourceId, sourceVersion });
      const output = await buildSettlementExportWorkbook(resolved.projection);
      const reservation = await reserveSettlementExportArtifact(tx, { sourceProjection: resolved.sourceProjection, format: "XLSX", createdById: actor.id });
      const finalized = await finalizeSettlementExportArtifact(tx, { auditId: reservation.audit.id, reservationToken: reservation.reservationToken, bytes: output.bytes });
      // Structured SettlementExportAudit identity includes approvedSnapshotId and optional dossierVersionId from the exact seal.
      return { output, finalized, canonicalHash: resolved.sourceProjection.projectionHash };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    if (!result.finalized.artifactBytes || !result.finalized.fileSha256) throw new Error("XLSX_FINALIZE_FAILED");
    return new Response(new Uint8Array(result.finalized.artifactBytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.output.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Settlement-Canonical-SHA256": result.canonicalHash,
        "X-Settlement-File-SHA256": result.finalized.fileSha256,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể xuất chứng từ.";
    if (/Thiếu source projection seal|exact source|canonical hash|signing snapshot/i.test(message)) return response(message, 409);
    if (/quyền|thành viên|project/i.test(message)) return response(message, 403);
    console.error("Sealed XLSX export failed", error);
    return response("Không thể xuất chứng từ từ exact source đã seal.", 500);
  }
}
