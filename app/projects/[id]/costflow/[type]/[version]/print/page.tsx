import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { requireUser, getMembership } from "@/lib/auth";
import { resolveSealedExportProjection, type SettlementExportFamily } from "@/lib/costflow/export";
import { buildSettlementPrintDocument, type SettlementPrintSigningEvent } from "@/lib/costflow/settlementSecurity";
import { prisma } from "@/lib/prisma";
import { absolutePublicVerificationUrl, deriveAuthorizedPublicTokenForExportAudit } from "@/lib/workflow/publicVerification";
import { createVerificationQrDataUrl } from "@/components/workflow/QrCode";
import SettlementPrintLayout from "@/components/costflow/settlement/SettlementPrintLayout";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FAMILY_BY_PATH: Readonly<Record<string, SettlementExportFamily>> = {
  quotation: "QUOTATION",
  "customer-acceptance": "CUSTOMER_ACCEPTANCE",
  dntu: "DNTU",
  dntt: "DNTT",
  dnhtu: "DNHTU",
  "project-settlement": "PROJECT_SETTLEMENT",
};

export default async function SettlementPrintPage({ params, searchParams }: {
  params: Promise<{ id: string; type: string; version: string }>;
  searchParams: Promise<{ sourceKind?: string; sourceVersion?: string }>;
}) {
  const actor = await requireUser();
  const { id: projectId, type, version: sourceId } = await params;
  const query = await searchParams;
  const family = FAMILY_BY_PATH[type.toLowerCase()];
  const sourceKind = query.sourceKind?.trim() ?? "";
  const sourceVersion = Number(query.sourceVersion);
  if (!family || !sourceId.trim() || !sourceKind || !Number.isSafeInteger(sourceVersion) || sourceVersion < 1) notFound();
  const membership = actor.role === "ADMIN" ? null : await getMembership(projectId, actor.id);
  if (actor.role !== "ADMIN" && !membership) notFound();

  const resolved = await prisma.$transaction(tx => resolveSealedExportProjection(tx, { projectId, family, sourceKind, sourceId, sourceVersion }));
  let signingEvents: SettlementPrintSigningEvent[] = [];
  if (resolved.sourceProjection.approvedSnapshotId) {
    const signingRows = await prisma.workflowSigningEvent.findMany({
      where: { snapshotId: resolved.sourceProjection.approvedSnapshotId },
      orderBy: [{ signedAt: "asc" }, { id: "asc" }],
      include: { actor: { select: { name: true } } },
    });
    signingEvents = signingRows.map(event => {
      const bytes = Buffer.from(event.signaturePngData);
      const imageSha256 = createHash("sha256").update(bytes).digest("hex");
      return {
        role: event.role,
        actorId: event.actorId,
        actorName: event.actor.name,
        signedAt: event.signedAt.toISOString(),
        imageSha256: event.signatureImageSha256,
        eventHash: event.eventHash,
        signatureDataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        confirmed: event.pinVerified && event.legalCommitment && imageSha256 === event.signatureImageSha256,
      };
    });
  }

  const finalizedPdf = await prisma.settlementExportAudit.findFirst({
    where: {
      projectId,
      family,
      format: "PDF",
      sourceProjectionId: resolved.sourceProjection.id,
      sourceKind,
      sourceId,
      sourceVersion,
      canonicalHash: resolved.sourceProjection.projectionHash,
      approvalAttemptId: resolved.sourceProjection.approvalAttemptId,
      approvedSnapshotId: resolved.sourceProjection.approvedSnapshotId,
      artifactStatus: "FINALIZED",
    },
    select: { id: true },
  });
  const publicVerificationToken = finalizedPdf && resolved.sourceProjection.approvedSnapshotId
    ? await deriveAuthorizedPublicTokenForExportAudit(finalizedPdf.id)
    : undefined;
  const doc = buildSettlementPrintDocument({ projection: resolved.projection, signingEvents, publicVerificationToken });
  const qrDataUrl = publicVerificationToken
    ? await createVerificationQrDataUrl(absolutePublicVerificationUrl(publicVerificationToken))
    : undefined;

  return <SettlementPrintLayout doc={doc} qrDataUrl={qrDataUrl} backHref={`/projects/${projectId}/costflow`} />;
}
