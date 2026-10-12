import { Prisma } from "@prisma/client";
import { getCurrentUser, getMembership } from "@/lib/auth";
import { resolveSealedExportProjection, type SettlementExportFamily } from "@/lib/costflow/export";
import { renderCostFlowPdf } from "@/lib/costflow/pdfExport";
import {
  failSettlementExportArtifact,
  finalizeSettlementExportArtifact,
  readFinalizedSettlementExportArtifact,
  reserveSettlementExportArtifact,
} from "@/lib/costflow/settlementSecurity";
import { prisma } from "@/lib/prisma";
import { deriveAuthorizedPublicTokenForExportAudit } from "@/lib/workflow/publicVerification";

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

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request, context: { params: Promise<{ id: string; type: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return jsonError("Unauthorized", 401);
  const { id: projectId, type } = await context.params;
  const family = FAMILY_BY_PATH[type.toLowerCase()];
  if (!family) return jsonError("Loại chứng từ PDF không hợp lệ.", 404);
  const search = new URL(request.url).searchParams;
  const sourceKind = search.get("sourceKind")?.trim() ?? "";
  const sourceId = search.get("sourceId")?.trim() ?? search.get("versionId")?.trim() ?? "";
  const sourceVersion = Number(search.get("sourceVersion"));
  if (!sourceKind || !sourceId || !Number.isSafeInteger(sourceVersion) || sourceVersion < 1) {
    return jsonError("Thiếu exact sourceKind/sourceId/sourceVersion đã được seal.", 400);
  }
  const membership = actor.role === "ADMIN" ? null : await getMembership(projectId, actor.id);
  if (actor.role !== "ADMIN" && !membership) return jsonError("Forbidden", 403);

  let reservation: { auditId: string; reservationToken: string } | undefined;
  try {
    const prepared = await prisma.$transaction(async tx => {
      const resolved = await resolveSealedExportProjection(tx, { projectId, family, sourceKind, sourceId, sourceVersion });
      const reserved = await reserveSettlementExportArtifact(tx, {
        sourceProjection: resolved.sourceProjection,
        format: "PDF",
        createdById: actor.id,
      });
      return { resolved, reserved };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    reservation = { auditId: prepared.reserved.audit.id, reservationToken: prepared.reserved.reservationToken };

    if (prepared.reserved.audit.artifactStatus !== "FINALIZED") {
      const publicVerificationToken = prepared.resolved.sourceProjection.approvedSnapshotId
        ? await deriveAuthorizedPublicTokenForExportAudit(prepared.reserved.audit.id)
        : undefined;
      const bytes = renderCostFlowPdf({
        projection: prepared.resolved.projection,
        sourceProjection: prepared.resolved.sourceProjection,
        publicVerificationToken,
      });
      await prisma.$transaction(tx => finalizeSettlementExportArtifact(tx, {
        auditId: prepared.reserved.audit.id,
        reservationToken: prepared.reserved.reservationToken,
        bytes,
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    }

    const artifact = await readFinalizedSettlementExportArtifact(prisma, prepared.reserved.audit.id);
    const safeFamily = family.toLowerCase().replaceAll("_", "-");
    return new Response(artifact.bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFamily}-${sourceVersion}.pdf`)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Settlement-Canonical-SHA256": prepared.resolved.sourceProjection.projectionHash,
        "X-Settlement-File-SHA256": artifact.audit.fileSha256!,
      },
    });
  } catch (error) {
    if (reservation) {
      await prisma.$transaction(tx => failSettlementExportArtifact(tx, reservation!.auditId, reservation!.reservationToken)).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "Không thể xuất PDF.";
    if (/Thiếu source projection seal|exact source|canonical hash|signing snapshot/i.test(message)) return jsonError(message, 409);
    if (/quyền|thành viên|project/i.test(message)) return jsonError(message, 403);
    console.error("Sealed PDF export failed", error);
    return jsonError("Không thể xuất PDF từ exact source đã seal.", 500);
  }
}
