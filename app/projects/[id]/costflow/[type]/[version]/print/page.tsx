import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { requireUser, getMembership } from "@/lib/auth";
import { calculateLineCost, totals as calculateTotals } from "@/lib/costflow/money";
import type { SettlementExportFamily, SettlementExportProjection } from "@/lib/costflow/export";
import {
  buildSettlementPrintDocument,
  settlementPdfAuditIdentity,
  validateSettlementExportAccess,
  type SettlementPrintSigningEvent,
} from "@/lib/costflow/settlementSecurity";
import { prisma } from "@/lib/prisma";
import {
  computeApprovedProjectionSha256,
  verifyApprovedProjectionAttestation,
  type WorkflowApprovedProjection,
} from "@/lib/workflow/approvedSnapshot";
import {
  absolutePublicVerificationUrl,
  deriveAuthorizedPublicTokenForSnapshot,
} from "@/lib/workflow/publicVerification";
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

function evidenceConfirmed(state: string) {
  return state === "DIGITAL_CONFIRMED" || state === "PHYSICAL_CONFIRMED";
}

function replacementState(input: { supersedesId: string | null; replacedBy: { id: string } | null }) {
  if (input.replacedBy) return `SUPERSEDED:${input.replacedBy.id}`;
  if (input.supersedesId) return `REPLACEMENT_OF:${input.supersedesId}`;
  return "ORIGINAL";
}

export default async function SettlementPrintPage({
  params,
}: {
  params: Promise<{ id: string; type: string; version: string }>;
}) {
  const actor = await requireUser();
  const { id: projectId, type, version: requestedVersionId } = await params;
  const family = FAMILY_BY_PATH[type.toLowerCase()];
  if (!family || !requestedVersionId.trim()) notFound();
  const membership = actor.role === "ADMIN" ? null : await getMembership(projectId, actor.id);
  if (actor.role !== "ADMIN" && !membership) notFound();

  const source = await prisma.projectSettlementVersion.findFirst({
    where: { id: requestedVersionId, projectId },
    include: {
      project: { select: { name: true } },
      request: { select: { id: true, state: true } },
      replacedBy: { select: { id: true } },
      obligations: { orderBy: [{ recipientKey: "asc" }] },
      evidence: { orderBy: [{ evidenceId: "asc" }] },
      locks: {
        orderBy: [{ actualCostApplicationId: "asc" }, { advanceApplicationId: "asc" }],
        include: { actualCostApplication: { include: { line: true, version: true } } },
      },
    },
  });
  if (!source) notFound();
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

  const approvedSnapshot = await prisma.workflowApprovedSnapshot.findFirst({
    where: { requestId: source.requestId },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });
  if (!approvedSnapshot) notFound();
  const approvedProjection = approvedSnapshot.projection as unknown as WorkflowApprovedProjection;
  if (
    computeApprovedProjectionSha256(approvedProjection) !== approvedSnapshot.projectionSha256 ||
    approvedSnapshot.attestationKeyId !== "v1" ||
    !verifyApprovedProjectionAttestation(approvedProjection, {
      keyId: "v1",
      algorithm: "HMAC-SHA256",
      value: approvedSnapshot.attestation,
    })
  ) {
    throw new Error("Snapshot đã duyệt không còn khớp digest/attestation phát hành.");
  }

  const signingRows = await prisma.workflowSigningEvent.findMany({
    where: { requestId: source.requestId, version: approvedSnapshot.version },
    orderBy: [{ signedAt: "asc" }, { id: "asc" }],
    include: { actor: { select: { name: true } } },
  });
  const signingEvents: SettlementPrintSigningEvent[] = signingRows.map(event => {
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

  const seenLines = new Set<string>();
  const items = source.locks.flatMap(lock => {
    const application = lock.actualCostApplication;
    if (!application || seenLines.has(application.line.stableLineId)) return [];
    seenLines.add(application.line.stableLineId);
    const lineVersion = application.version;
    return [{
      stableLineId: application.line.stableLineId,
      description: lineVersion.description,
      recipientKey: application.recipientKey,
      ...calculateLineCost({
        quantity: lineVersion.quantity,
        days: lineVersion.days,
        unitPrice: lineVersion.unitPrice,
        basis: lineVersion.basis === "NET" ? "NET" : "GROSS",
        vatPercent: lineVersion.vatPercent,
      }),
    }];
  });
  const calculated = calculateTotals(items);
  const obligationGross = source.obligations.reduce((sum, row) => sum + BigInt(row.approvedAcGross), BigInt(0));
  if (obligationGross !== BigInt(calculated.gross)) throw new Error("Nguồn AC bất biến không khớp tổng quyết toán.");

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
      events: signingRows.filter(event => event.pinVerified && event.legalCommitment).map(event => ({
        role: event.role,
        actorId: event.actorId,
        eventHash: event.eventHash,
        signedAt: event.signedAt.toISOString(),
      })),
    },
  };
  const audit = settlementPdfAuditIdentity(projection);
  const idempotencyKey = [
    "SETTLEMENT_PRINT_V1",
    family,
    source.id,
    audit.canonicalHash,
    `replacement=${replacementState(source)}`,
    `signature=${approvedSnapshot.id}:${approvedSnapshot.evidenceState}`,
  ].join(":");
  await prisma.settlementExportAudit.upsert({
    where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
    create: {
      projectId,
      dossierVersionId: source.id,
      family,
      format: "PDF",
      canonicalHash: audit.canonicalHash,
      approvedSnapshotId: approvedSnapshot.id,
      idempotencyKey,
      createdById: actor.id,
    },
    update: {},
  });

  let publicVerificationToken: string | undefined;
  if (evidenceConfirmed(approvedSnapshot.evidenceState)) {
    const capability = await prisma.workflowPublicVerificationCapability.findUnique({
      where: { snapshotId: approvedSnapshot.id },
      select: { revokedAt: true, replacedAt: true },
    });
    if (!capability?.revokedAt && !capability?.replacedAt) {
      publicVerificationToken = await deriveAuthorizedPublicTokenForSnapshot(approvedSnapshot.id);
    }
  }
  const doc = buildSettlementPrintDocument({ projection, signingEvents, publicVerificationToken });
  const qrDataUrl = publicVerificationToken
    ? await createVerificationQrDataUrl(absolutePublicVerificationUrl(publicVerificationToken))
    : undefined;

  return (
    <SettlementPrintLayout
      doc={doc}
      qrDataUrl={qrDataUrl}
      backHref={`/projects/${projectId}/costflow`}
    />
  );
}
