import "server-only";

import type { WorkflowApprovedSnapshot } from "@prisma/client";
import { createVerificationQrDataUrl } from "@/components/workflow/QrCode";
import type { WorkflowPrintDocument } from "@/components/WorkflowPrintView";
import { computeApprovedProjectionSha256, verifyApprovedProjectionAttestation, type WorkflowApprovedProjection } from "./approvedSnapshot";
import { absolutePublicVerificationUrl, deriveAuthorizedPublicTokenForSnapshot } from "./publicVerification";

export async function approvedSnapshotPrintDocument(snapshot: WorkflowApprovedSnapshot): Promise<WorkflowPrintDocument> {
  const projection = snapshot.projection as unknown as WorkflowApprovedProjection;
  const digest = computeApprovedProjectionSha256(projection);
  if (digest !== snapshot.projectionSha256) throw new Error("Snapshot in không còn khớp mã băm đã duyệt.");
  if (snapshot.attestationKeyId !== "v1" || !verifyApprovedProjectionAttestation(projection, { keyId: "v1", algorithm: "HMAC-SHA256", value: snapshot.attestation })) {
    throw new Error("Không xác thực được nguồn phát hành snapshot.");
  }
  const token = await deriveAuthorizedPublicTokenForSnapshot(snapshot.id);
  const verifyUrl = absolutePublicVerificationUrl(token);
  return {
    code: `HS-${projection.request.id.slice(-8).toUpperCase()}`,
    title: projection.request.title,
    kind: projection.request.kind,
    approvedAt: projection.request.approvedAt,
    creatorName: projection.request.creatorName,
    amount: projection.finance.amount,
    content: projection.document.content || projection.document.purpose,
    financeLines: projection.finance.lines,
    signatures: projection.signatures.map(item => ({ role: item.role, name: item.actorName, signedAt: item.signedAt })),
    projectionSha256: snapshot.projectionSha256,
    signingMode: snapshot.mode as "DIGITAL" | "PHYSICAL",
    qrDataUrl: await createVerificationQrDataUrl(verifyUrl),
    isDraft: false,
  };
}
