import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const ROLE_ORDER = new Map([["CREATOR", 0], ["MANAGER", 1], ["ACCOUNTANT", 2], ["CEO", 3]]);

export type ApprovedProjectionInput = {
  request: { id: string; version: number; module: string; kind: string; creatorId: string; creatorName?: string; title: string; approvedAt: string };
  template: { familyId: string; version: number; name: string };
  document: { purpose: string; content: string; counterparty: string; beneficiary: string; bankAccount: string; bankName: string; dueDate: string };
  finance: { source: string; snapshotId: string; amount: string; lines: readonly { id: string; description: string; amount: string }[] };
  files: readonly { id: string; kind: string; name: string; sha256: string }[];
  decisions: readonly { step: number; role: string; actorId: string; action: string; decidedAt: string }[];
  signatures: readonly { role: string; actorId: string; actorName?: string; signedAt: string; imageSha256: string; eventHash: string }[];
};

export function buildApprovedProjection(input: ApprovedProjectionInput) {
  return {
    schemaVersion: 1 as const,
    request: { ...input.request, creatorName: input.request.creatorName ?? "" },
    template: { ...input.template },
    document: { ...input.document },
    finance: {
      source: input.finance.source,
      snapshotId: input.finance.snapshotId,
      amount: input.finance.amount,
      lines: [...input.finance.lines].map((line) => ({ ...line })).sort((a, b) => a.id.localeCompare(b.id)),
    },
    files: [...input.files].map((file) => ({ ...file })).sort((a, b) => a.id.localeCompare(b.id)),
    decisions: [...input.decisions].map((decision) => ({ ...decision })).sort((a, b) => a.step - b.step || a.role.localeCompare(b.role)),
    signatures: [...input.signatures].map((signature) => ({ ...signature, actorName: signature.actorName ?? "" })).sort((a, b) =>
      (ROLE_ORDER.get(a.role) ?? 99) - (ROLE_ORDER.get(b.role) ?? 99) || a.role.localeCompare(b.role)),
  };
}

export type WorkflowApprovedProjection = ReturnType<typeof buildApprovedProjection>;
export type ProjectionAttestation = { keyId: "v1"; algorithm: "HMAC-SHA256"; value: string };

export function computeApprovedProjectionSha256(projection: WorkflowApprovedProjection) {
  return createHash("sha256").update(JSON.stringify(projection), "utf8").digest("hex");
}

function attestationKeyV1() {
  const key = process.env.DOCUMENT_ATTESTATION_KEY_V1;
  if (!key) throw new Error("Thiếu DOCUMENT_ATTESTATION_KEY_V1 cho xác thực nguồn phát hành.");
  return key;
}

export function attestApprovedProjection(projection: WorkflowApprovedProjection): ProjectionAttestation {
  return {
    keyId: "v1",
    algorithm: "HMAC-SHA256",
    value: createHmac("sha256", attestationKeyV1())
      .update(computeApprovedProjectionSha256(projection), "utf8")
      .digest("hex"),
  };
}

export function verifyApprovedProjectionAttestation(projection: WorkflowApprovedProjection, attestation: ProjectionAttestation) {
  if (attestation.keyId !== "v1" || attestation.algorithm !== "HMAC-SHA256") return false;
  const expected = Buffer.from(attestApprovedProjection(projection).value, "hex");
  const actual = Buffer.from(attestation.value, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
