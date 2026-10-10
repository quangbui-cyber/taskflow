import "server-only";

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  computeApprovedProjectionSha256,
  verifyApprovedProjectionAttestation,
  type WorkflowApprovedProjection,
} from "./approvedSnapshot";

const TOKEN_DOMAIN = "paperwork-advanced:workflow-public-verification:v1";
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 300;

export type PublicVerificationDto = {
  valid: true;
  dossierCode: string;
  templateName: string;
  approvedAt: string;
  requesterName: string;
  amount: string;
  signers: readonly { role: string; name: string; signedAt: string }[];
  digestShort: string;
  statement: "INTERNAL_ISSUER_ATTESTATION";
};

function attestationKey(keyId: string) {
  if (keyId !== "v1") throw new Error("Phiên bản khóa xác thực công khai không được hỗ trợ.");
  const key = process.env.DOCUMENT_ATTESTATION_KEY_V1;
  if (!key) throw new Error("Thiếu DOCUMENT_ATTESTATION_KEY_V1 cho xác thực công khai.");
  return key;
}

export function derivePublicVerificationToken(input: {
  capabilityId: string;
  publicNonce: string;
  snapshotDigest: string;
  keyId: string;
}) {
  return createHmac("sha256", attestationKey(input.keyId))
    .update(`${TOKEN_DOMAIN}\n${input.capabilityId}\n${input.publicNonce}\n${input.snapshotDigest}`, "utf8")
    .digest("base64url");
}

export function digestPublicVerificationToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function ensurePublicCapabilityForSnapshot(snapshotId: string) {
  const existing = await prisma.workflowPublicVerificationCapability.findUnique({
    where: { snapshotId },
    include: { snapshot: { select: { projectionSha256: true } } },
  });
  if (existing) return existing;
  const snapshot = await prisma.workflowApprovedSnapshot.findUnique({
    where: { id: snapshotId },
    select: { id: true, projectionSha256: true, attestationKeyId: true },
  });
  if (!snapshot) throw new Error("Không tìm thấy snapshot đã duyệt.");
  const id = randomUUID();
  const publicNonce = randomBytes(32).toString("base64url");
  const token = derivePublicVerificationToken({
    capabilityId: id,
    publicNonce,
    snapshotDigest: snapshot.projectionSha256,
    keyId: snapshot.attestationKeyId,
  });
  return prisma.workflowPublicVerificationCapability.upsert({
    where: { snapshotId: snapshot.id },
    create: { id, snapshotId: snapshot.id, publicNonce, tokenDigest: digestPublicVerificationToken(token), attestationKeyId: snapshot.attestationKeyId },
    update: {},
    include: { snapshot: { select: { projectionSha256: true } } },
  });
}

export async function deriveAuthorizedPublicTokenForSnapshot(snapshotId: string) {
  const capability = await ensurePublicCapabilityForSnapshot(snapshotId);
  if (capability.revokedAt || capability.replacedAt) throw new Error("Capability xác thực công khai không còn hoạt động.");
  return derivePublicVerificationToken({
    capabilityId: capability.id,
    publicNonce: capability.publicNonce,
    snapshotDigest: capability.snapshot.projectionSha256,
    keyId: capability.attestationKeyId,
  });
}

async function consumeAttempt(tokenDigest: string) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  const key = createHmac("sha256", attestationKey("v1")).update(`public-rate:${tokenDigest.slice(0, 16)}`).digest("hex");
  return prisma.$transaction(async tx => {
    await tx.workflowPublicVerificationRateLimit.upsert({
      where: { key },
      create: { key, attempts: 0, windowStartedAt: now },
      update: {},
    });
    await tx.workflowPublicVerificationRateLimit.updateMany({
      where: { key, windowStartedAt: { lt: cutoff } },
      data: { attempts: 0, windowStartedAt: now, blockedUntil: null },
    });
    const current = await tx.workflowPublicVerificationRateLimit.findUniqueOrThrow({ where: { key } });
    if (current.blockedUntil && current.blockedUntil > now) return false;
    const next = await tx.workflowPublicVerificationRateLimit.update({
      where: { key },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    if (next.attempts > ATTEMPT_LIMIT) {
      await tx.workflowPublicVerificationRateLimit.update({
        where: { key },
        data: { blockedUntil: new Date(now.getTime() + BLOCK_MS) },
      });
      return false;
    }
    return true;
  });
}

function safeTokenEquals(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicDto(projection: WorkflowApprovedProjection, digest: string): PublicVerificationDto {
  return {
    valid: true,
    dossierCode: `HS-${projection.request.id.slice(-8).toUpperCase()}`,
    templateName: projection.template.name,
    approvedAt: projection.request.approvedAt,
    requesterName: projection.request.creatorName,
    amount: projection.finance.amount,
    signers: projection.signatures.map(item => ({ role: item.role, name: item.actorName, signedAt: item.signedAt })),
    digestShort: digest.slice(0, 12),
    statement: "INTERNAL_ISSUER_ATTESTATION",
  };
}

export async function verifyPublicCapability(tokenInput: string): Promise<{ status: "VALID"; data: PublicVerificationDto } | { status: "INVALID" }> {
  const token = tokenInput.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { status: "INVALID" };
  const tokenDigest = digestPublicVerificationToken(token);
  try {
    if (!await consumeAttempt(tokenDigest)) return { status: "INVALID" };
    const capability = await prisma.workflowPublicVerificationCapability.findUnique({
      where: { tokenDigest },
      include: { snapshot: true },
    });
    if (!capability || capability.revokedAt || capability.replacedAt) return { status: "INVALID" };
    const expected = derivePublicVerificationToken({
      capabilityId: capability.id,
      publicNonce: capability.publicNonce,
      snapshotDigest: capability.snapshot.projectionSha256,
      keyId: capability.attestationKeyId,
    });
    if (!safeTokenEquals(token, expected)) return { status: "INVALID" };
    const projection = capability.snapshot.projection as unknown as WorkflowApprovedProjection;
    if (computeApprovedProjectionSha256(projection) !== capability.snapshot.projectionSha256) return { status: "INVALID" };
    if (capability.snapshot.attestationKeyId !== capability.attestationKeyId) return { status: "INVALID" };
    if (!verifyApprovedProjectionAttestation(projection, {
      keyId: "v1",
      algorithm: "HMAC-SHA256",
      value: capability.snapshot.attestation,
    })) return { status: "INVALID" };
    const roles = projection.signatures.map(item => item.role);
    if (!["CREATOR", "MANAGER", "ACCOUNTANT", "CEO"].every(role => roles.includes(role))) return { status: "INVALID" };
    return { status: "VALID", data: publicDto(projection, capability.snapshot.projectionSha256) };
  } catch {
    return { status: "INVALID" };
  }
}
