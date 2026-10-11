import type { Prisma } from "@prisma/client";
import { getCurrentUser, getMembership } from "@/lib/auth";
import {
  buildSettlementExportWorkbook,
  type SettlementExportFamily,
  type SettlementExportProjection,
} from "@/lib/costflow/export";
import { calculateLineCost, totals as calculateTotals } from "@/lib/costflow/money";
import {
  settlementFileHash,
  settlementProjectionHash,
  validateSettlementExportAccess,
} from "@/lib/costflow/settlementSecurity";
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

function object(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function response(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function replacementState(input: { supersedesId: string | null; replacedBy: { id: string } | null }) {
  if (input.replacedBy) return `SUPERSEDED:${input.replacedBy.id}`;
  if (input.supersedesId) return `REPLACEMENT_OF:${input.supersedesId}`;
  return "ORIGINAL";
}

export async function GET(request: Request, context: { params: Promise<{ id: string; type: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return response("Unauthorized", 401);
  const { id: projectId, type } = await context.params;
  const family = FAMILY_BY_PATH[type.toLowerCase()];
  if (!family) return response("Loại chứng từ XLSX không hợp lệ.", 404);
  const requestedVersionId = new URL(request.url).searchParams.get("versionId")?.trim() ?? "";
  if (!requestedVersionId) return response("Thiếu versionId nguồn bất biến.", 400);
  const membership = actor.role === "ADMIN" ? null : await getMembership(projectId, actor.id);
  if (actor.role !== "ADMIN" && !membership) return response("Forbidden", 403);

  try {
    const result = await prisma.$transaction(async tx => {
      const source = await tx.projectSettlementVersion.findFirst({
        where: { id: requestedVersionId, projectId },
        include: {
          project: { select: { name: true } },
          request: { select: { id: true, state: true } },
          replacedBy: { select: { id: true } },
          obligations: { orderBy: [{ recipientKey: "asc" }] },
          evidence: { orderBy: [{ evidenceId: "asc" }] },
          locks: {
            orderBy: [{ actualCostApplicationId: "asc" }, { advanceApplicationId: "asc" }],
            include: {
              actualCostApplication: {
                include: { line: true, version: true },
              },
            },
          },
        },
      });
      if (!source) throw new Error("NOT_FOUND");
      const approvedSnapshot = await tx.workflowApprovedSnapshot.findFirst({
        where: {
          requestId: source.requestId,
          evidenceState: { in: ["DIGITAL_CONFIRMED", "PHYSICAL_CONFIRMED"] },
        },
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
        include: { signingEvents: { orderBy: [{ signedAt: "asc" }, { id: "asc" }] } },
      });
      if (!approvedSnapshot) throw new Error("SIGNING_SNAPSHOT_REQUIRED");
      validateSettlementExportAccess({
        actorId: actor.id,
        actorRole: actor.role,
        membershipProjectId: membership?.projectId ?? null,
        routeProjectId: projectId,
        sourceProjectId: source.projectId,
        requestedVersionId,
        sourceVersionId: source.id,
        sourceState: source.request.state,
      });

      const seenLines = new Set<string>();
      const items = source.locks.flatMap(lock => {
        const application = lock.actualCostApplication;
        if (!application || seenLines.has(application.line.stableLineId)) return [];
        seenLines.add(application.line.stableLineId);
        const version = application.version;
        const calculated = calculateLineCost({
          quantity: version.quantity,
          days: version.days,
          unitPrice: version.unitPrice,
          basis: version.basis === "NET" ? "NET" : "GROSS",
          vatPercent: version.vatPercent,
        });
        return [{
          stableLineId: application.line.stableLineId,
          description: version.description,
          recipientKey: application.recipientKey,
          ...calculated,
        }];
      });
      const calculated = calculateTotals(items);
      const obligationGross = source.obligations.reduce((sum, row) => sum + BigInt(row.approvedAcGross), BigInt(0));
      if (obligationGross !== BigInt(calculated.gross)) throw new Error("SOURCE_TOTAL_MISMATCH");
      const projection: SettlementExportProjection = {
        projectId,
        projectName: source.project.name,
        family,
        source: {
          dossierId: source.dossierId,
          dossierVersionId: source.id,
          dossierVersion: source.version,
          documentVersionId: approvedSnapshot.id,
          documentVersion: approvedSnapshot.version,
          state: source.request.state,
          supersedesId: source.supersedesId,
          replacedById: source.replacedBy?.id ?? null,
          replacementReason: source.replacementReason,
        },
        title: family === "PROJECT_SETTLEMENT" ? "Quyết toán dự án" : family,
        approvedAt: approvedSnapshot.createdAt.toISOString(),
        totals: calculated,
        recipients: source.obligations.map(row => ({
          recipientKey: row.recipientKey,
          recipientType: row.recipientType,
          displayName: row.recipientType === "VENDOR" ? "Nhà cung cấp" : "Nhân sự",
          actualGross: row.approvedAcGross,
          advanceGross: row.disbursedAdvance,
          refundDue: row.direction === "REFUND" ? row.amountDue : "0",
          additionalDue: row.direction === "ADDITIONAL" ? row.amountDue : "0",
        })),
        items,
        obligations: source.obligations.map(row => ({ recipientKey: row.recipientKey, direction: row.direction, amountDue: row.amountDue })),
        evidence: source.evidence.map(row => ({ id: row.evidenceId, kind: row.kind, sha256: row.sha256 })),
        signingSnapshot: {
          id: approvedSnapshot.id,
          state: approvedSnapshot.evidenceState,
          projectionSha256: approvedSnapshot.projectionSha256,
          events: approvedSnapshot.signingEvents.map(event => ({
            role: event.role,
            actorId: event.actorId,
            eventHash: event.eventHash,
            signedAt: event.signedAt.toISOString(),
          })),
        },
      };
      const canonicalHash = settlementProjectionHash(projection);
      const output = await buildSettlementExportWorkbook(projection);
      const fileSha256 = settlementFileHash(output.bytes);
      const sourceReplacementState = replacementState(source);
      const idempotencyKey = [
        "SETTLEMENT_EXPORT_V1",
        family,
        source.id,
        canonicalHash,
        `fileSha256=${fileSha256}`,
        `replacement=${sourceReplacementState}`,
        `signature=${approvedSnapshot.id}:${approvedSnapshot.evidenceState}`,
      ].join(":");
      await tx.settlementExportAudit.upsert({
        where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
        create: {
          projectId,
          dossierVersionId: source.id,
          family,
          format: "XLSX",
          canonicalHash,
          approvedSnapshotId: approvedSnapshot.id,
          idempotencyKey,
          createdById: actor.id,
        },
        update: {},
      });
      return { output, canonicalHash, fileSha256 };
    });

    return new Response(new Uint8Array(result.output.bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.output.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Settlement-Canonical-SHA256": result.canonicalHash,
        "X-Settlement-File-SHA256": result.fileSha256,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể xuất chứng từ.";
    if (message === "NOT_FOUND") return response("Không tìm thấy phiên bản quyết toán trong Project.", 404);
    if (message === "SIGNING_SNAPSHOT_REQUIRED") return response("Phiên bản chưa có snapshot chữ ký xác nhận.", 409);
    if (message === "SOURCE_TOTAL_MISMATCH") return response("Nguồn AC bất biến không khớp tổng quyết toán.", 409);
    if (/quyền|thành viên|project|phiên bản|immutable|duyệt/i.test(message)) return response(message, 403);
    console.error("Settlement XLSX export failed", error);
    return response("Không thể xuất chứng từ quyết toán.", 500);
  }
}

