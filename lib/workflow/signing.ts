import { createHash } from "node:crypto";
import { isIP } from "node:net";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { attestApprovedProjection, buildApprovedProjection, computeApprovedProjectionSha256 } from "./approvedSnapshot";
import { assertSixDigitSignaturePin, decodeSignaturePngDataUrl } from "./signatureAssets";

export type SigningMode = "DIGITAL" | "PHYSICAL";
export type SigningEvidenceState = "CHO_KY" | "DIGITAL_CONFIRMED" | "PENDING" | "RETURNED" | "PHYSICAL_CONFIRMED";
export type SignerIpSource = "DIRECT" | "TRUSTED_PROXY" | "UNAVAILABLE";
export type DigitalSigningRole = "CREATOR" | "MANAGER" | "ACCOUNTANT" | "CEO";

const DIGITAL_SIGNING_ROLES: readonly DigitalSigningRole[] = ["CREATOR", "MANAGER", "ACCOUNTANT", "CEO"];
const DIGITAL_SIGNATURE_KINDS = new Set([
  "ADVANCE",
  "VENDOR_PAYMENT",
  "REIMBURSEMENT",
  "PROPOSAL",
  "PROPOSAL_ADVANCE",
  "PROPOSAL_ADVANCE_SETTLEMENT",
  "SERVICE_CONTRACT",
]);

export function requiresDigitalSignature(kind: string) {
  return DIGITAL_SIGNATURE_KINDS.has(kind);
}

function normalizeIp(value: string | null | undefined) {
  let candidate = String(value ?? "").trim();
  if (!candidate) return null;
  const bracketed = candidate.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) candidate = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  const kind = isIP(candidate);
  if (!kind) return null;
  if (kind === 4) return candidate.split(".").map((part) => String(Number(part))).join(".");
  try {
    return new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

export function resolveSignerIp(input: { directPeer: string | null; forwardedFor: string | null; trustedProxies?: readonly string[] }) {
  const direct = normalizeIp(input.directPeer);
  if (!direct) return { signerIpNormalized: null, signerIpSource: "UNAVAILABLE" as const };
  const trusted = new Set((input.trustedProxies ?? []).map(normalizeIp).filter((ip): ip is string => Boolean(ip)));
  if (!trusted.has(direct)) return { signerIpNormalized: direct, signerIpSource: "DIRECT" as const };
  const hops = String(input.forwardedFor ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  if (!hops.length || hops.length > 10) return { signerIpNormalized: null, signerIpSource: "UNAVAILABLE" as const };
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = normalizeIp(hops[index]);
    if (!hop) return { signerIpNormalized: null, signerIpSource: "UNAVAILABLE" as const };
    if (!trusted.has(hop)) return { signerIpNormalized: hop, signerIpSource: "TRUSTED_PROXY" as const };
  }
  return { signerIpNormalized: null, signerIpSource: "UNAVAILABLE" as const };
}

export function assertSigningModeState(mode: SigningMode, state: SigningEvidenceState) {
  const allowed = mode === "DIGITAL"
    ? new Set<SigningEvidenceState>(["CHO_KY", "DIGITAL_CONFIRMED"])
    : new Set<SigningEvidenceState>(["PENDING", "RETURNED", "PHYSICAL_CONFIRMED"]);
  if (!allowed.has(state)) throw new Error("Trạng thái bằng chứng không thuộc chế độ ký đã chọn.");
}

export function computeSigningEventHash(input: { snapshotSha256: string; role: string; actorId: string; imageSha256: string; signedAt: string; previousEventHash?: string | null }) {
  return createHash("sha256").update(JSON.stringify({
    snapshotSha256: input.snapshotSha256,
    role: input.role,
    actorId: input.actorId,
    imageSha256: input.imageSha256,
    signedAt: input.signedAt,
    previousEventHash: input.previousEventHash ?? null,
  })).digest("hex");
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function appendDigitalSigningEvent(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string;
    version: number;
    kind: string;
    role: DigitalSigningRole;
    actorId: string;
    signatureData: unknown;
    signaturePin: unknown;
    commandKey: string;
    signerIpNormalized?: string | null;
    signerIpSource?: SignerIpSource;
  },
) {
  if (!requiresDigitalSignature(input.kind)) return null;
  if (!Number.isSafeInteger(input.version) || input.version < 0) throw new Error("Phiên bản ký số không hợp lệ.");
  if (!DIGITAL_SIGNING_ROLES.includes(input.role)) throw new Error("Vai trò ký số không hợp lệ.");

  const signature = decodeSignaturePngDataUrl(input.signatureData);
  const pin = assertSixDigitSignaturePin(input.signaturePin);
  const account = await tx.user.findFirst({
    where: { id: input.actorId, isActive: true },
    select: { signaturePinHash: true },
  });
  if (!account?.signaturePinHash) throw new Error("Bạn cần thiết lập mã PIN chữ ký trong Hồ sơ cá nhân trước khi ký.");
  if (!await bcrypt.compare(pin, account.signaturePinHash)) throw new Error("Mã PIN chữ ký không đúng.");

  const lifecycle = await tx.workflowSigningLifecycle.findUnique({ where: { requestId: input.requestId } });
  if (lifecycle && (lifecycle.mode !== "DIGITAL" || lifecycle.expectedVersion !== input.version)) {
    throw new Error("Hồ sơ đã chọn chế độ ký khác hoặc phiên bản ký đã thay đổi.");
  }
  if (!lifecycle) {
    await tx.workflowSigningLifecycle.create({
      data: { requestId: input.requestId, mode: "DIGITAL", evidenceState: "CHO_KY", expectedVersion: input.version },
    });
  }

  const fingerprint = createHash("sha256").update(JSON.stringify({
    requestId: input.requestId,
    version: input.version,
    role: input.role,
    actorId: input.actorId,
    signatureImageSha256: signature.sha256,
  })).digest("hex");
  const priorCommand = await tx.workflowSigningCommand.findUnique({
    where: { requestId_commandKey: { requestId: input.requestId, commandKey: input.commandKey } },
  });
  if (priorCommand) {
    if (priorCommand.fingerprint !== fingerprint) throw new Error("Khóa thao tác ký đã được dùng cho nội dung khác.");
    return tx.workflowSigningEvent.findUnique({
      where: { requestId_version_role: { requestId: input.requestId, version: input.version, role: input.role } },
    });
  }

  const existing = await tx.workflowSigningEvent.findUnique({
    where: { requestId_version_role: { requestId: input.requestId, version: input.version, role: input.role } },
  });
  if (existing) throw new Error("Vai trò này đã ký phiên bản hồ sơ hiện tại.");
  const previous = await tx.workflowSigningEvent.findFirst({
    where: { requestId: input.requestId, version: input.version },
    orderBy: [{ signedAt: "desc" }, { id: "desc" }],
  });
  const signedAt = new Date();
  const signingScopeSha256 = createHash("sha256")
    .update(JSON.stringify({ requestId: input.requestId, version: input.version, mode: "DIGITAL" }))
    .digest("hex");
  const event = await tx.workflowSigningEvent.create({
    data: {
      requestId: input.requestId,
      version: input.version,
      role: input.role,
      actorId: input.actorId,
      signaturePngData: Uint8Array.from(signature.bytes),
      signatureImageSha256: signature.sha256,
      legalCommitment: true,
      previousEventHash: previous?.eventHash ?? null,
      eventHash: computeSigningEventHash({
        snapshotSha256: signingScopeSha256,
        role: input.role,
        actorId: input.actorId,
        imageSha256: signature.sha256,
        signedAt: signedAt.toISOString(),
        previousEventHash: previous?.eventHash,
      }),
      pinVerified: true,
      signerIpNormalized: input.signerIpNormalized ?? null,
      signerIpSource: input.signerIpSource ?? "UNAVAILABLE",
      signedAt,
    },
  });
  await tx.workflowSigningCommand.create({
    data: { requestId: input.requestId, commandKey: input.commandKey, fingerprint, result: json({ eventId: event.id }) },
  });
  const count = await tx.workflowSigningEvent.count({ where: { requestId: input.requestId, version: input.version } });
  if (count === DIGITAL_SIGNING_ROLES.length) {
    await tx.workflowSigningLifecycle.update({
      where: { requestId: input.requestId },
      data: { evidenceState: "DIGITAL_CONFIRMED" },
    });
  }
  return event;
}

export async function finalizeDigitalApprovedSnapshot(
  tx: Prisma.TransactionClient,
  input: { requestId: string; version: number },
) {
  const request = await tx.workflowRequest.findUnique({
    where: { id: input.requestId },
    include: {
      template: true,
      files: { select: { id: true, kind: true, name: true, sha256: true } },
      decisions: { orderBy: [{ step: "asc" }, { createdAt: "asc" }] },
      workflowSigningEvents: { where: { version: input.version }, orderBy: { signedAt: "asc" } },
      paymentLines: { orderBy: { position: "asc" } },
    },
  });
  if (!request || !requiresDigitalSignature(request.kind)) return null;
  const lifecycle = await tx.workflowSigningLifecycle.findUnique({ where: { requestId: request.id } });
  if (!lifecycle || lifecycle.mode !== "DIGITAL" || lifecycle.expectedVersion !== input.version || lifecycle.evidenceState !== "DIGITAL_CONFIRMED") {
    throw new Error("Hồ sơ chưa đủ bốn chữ ký số hợp lệ để phát hành bản duyệt.");
  }
  const signatures = request.workflowSigningEvents;
  if (signatures.length !== DIGITAL_SIGNING_ROLES.length || DIGITAL_SIGNING_ROLES.some(role => !signatures.some(item => item.role === role))) {
    throw new Error("Chuỗi chữ ký số chưa đủ Người lập, Quản lý, Kế toán và CEO.");
  }
  const payload = request.payload && typeof request.payload === "object" ? request.payload as Record<string, unknown> : {};
  const signerNames = new Map((await tx.user.findMany({
    where: { id: { in: [...new Set([request.creatorId, ...signatures.map(item => item.actorId)])] } },
    select: { id: true, name: true },
  })).map(person => [person.id, person.name]));
  const projection = buildApprovedProjection({
    request: {
      id: request.id,
      version: input.version,
      module: request.module,
      kind: request.kind,
      creatorId: request.creatorId,
      creatorName: signerNames.get(request.creatorId) ?? "",
      title: request.title,
      approvedAt: new Date().toISOString(),
    },
    template: {
      familyId: request.template?.familyId ?? "",
      version: request.template?.version ?? 0,
      name: request.template?.name ?? request.kind,
    },
    document: {
      purpose: String(payload.purpose ?? payload.milestone ?? ""),
      content: String(payload.content ?? payload.explanation ?? ""),
      counterparty: String(payload.counterparty ?? ""),
      beneficiary: String(payload.beneficiary ?? ""),
      bankAccount: String(payload.bankAccount ?? ""),
      bankName: String(payload.bankName ?? ""),
      dueDate: String(payload.dueDate ?? ""),
    },
    finance: {
      source: request.module,
      snapshotId: `${request.id}:${input.version}`,
      amount: String(payload.amount ?? ""),
      lines: request.paymentLines.map(line => ({ id: line.stableKey, description: line.description, amount: line.amount })),
    },
    files: request.files,
    decisions: request.decisions.map(decision => ({
      step: decision.step,
      role: DIGITAL_SIGNING_ROLES[decision.step + 1] ?? "UNKNOWN",
      actorId: decision.actorId,
      action: decision.action,
      decidedAt: decision.createdAt.toISOString(),
    })),
    signatures: signatures.map(item => ({
      role: item.role,
      actorId: item.actorId,
      actorName: signerNames.get(item.actorId) ?? "",
      signedAt: item.signedAt.toISOString(),
      imageSha256: item.signatureImageSha256,
      eventHash: item.eventHash,
    })),
  });
  const attestation = attestApprovedProjection(projection);
  const snapshot = await tx.workflowApprovedSnapshot.upsert({
    where: { requestId_version: { requestId: request.id, version: input.version } },
    create: {
      requestId: request.id,
      version: input.version,
      mode: "DIGITAL",
      evidenceState: "DIGITAL_CONFIRMED",
      projection: json(projection),
      projectionSha256: computeApprovedProjectionSha256(projection),
      attestationKeyId: attestation.keyId,
      attestation: attestation.value,
    },
    update: {},
  });
  await tx.workflowSigningEvent.updateMany({
    where: { requestId: request.id, version: input.version, snapshotId: null },
    data: { snapshotId: snapshot.id },
  });
  await tx.workflowSigningLifecycle.update({ where: { requestId: request.id }, data: { snapshotId: snapshot.id } });
  return snapshot;
}

export async function finalizePhysicalApprovedSnapshot(tx: Prisma.TransactionClient, input: { requestId: string; version: number }) {
  const request = await tx.workflowRequest.findUnique({
    where: { id: input.requestId },
    include: { template: true, files: { select: { id: true, kind: true, name: true, sha256: true } }, decisions: { orderBy: [{ step: "asc" }, { createdAt: "asc" }] }, paymentLines: { orderBy: { position: "asc" } } },
  });
  if (!request || !requiresDigitalSignature(request.kind)) return null;
  const lifecycle = await tx.workflowSigningLifecycle.findUnique({ where: { requestId: request.id } });
  if (!lifecycle || lifecycle.mode !== "PHYSICAL" || lifecycle.expectedVersion !== input.version || lifecycle.evidenceState !== "CHO_KY") throw new Error("Hồ sơ không ở chế độ chờ ký giấy đúng phiên bản.");
  const creator = await tx.user.findUnique({ where: { id: request.creatorId }, select: { name: true } });
  const payload = request.payload && typeof request.payload === "object" ? request.payload as Record<string, unknown> : {};
  const projection = buildApprovedProjection({
    request: { id: request.id, version: input.version, module: request.module, kind: request.kind, creatorId: request.creatorId, creatorName: creator?.name ?? "", title: request.title, approvedAt: new Date().toISOString() },
    template: { familyId: request.template?.familyId ?? "", version: request.template?.version ?? 0, name: request.template?.name ?? request.kind },
    document: { purpose: String(payload.purpose ?? payload.milestone ?? ""), content: String(payload.content ?? payload.explanation ?? ""), counterparty: String(payload.counterparty ?? ""), beneficiary: String(payload.beneficiary ?? ""), bankAccount: String(payload.bankAccount ?? ""), bankName: String(payload.bankName ?? ""), dueDate: String(payload.dueDate ?? "") },
    finance: { source: request.module, snapshotId: `${request.id}:${input.version}`, amount: String(payload.amount ?? ""), lines: request.paymentLines.map(line => ({ id: line.stableKey, description: line.description, amount: line.amount })) },
    files: request.files,
    decisions: request.decisions.map(decision => ({ step: decision.step, role: DIGITAL_SIGNING_ROLES[decision.step + 1] ?? "UNKNOWN", actorId: decision.actorId, action: decision.action, decidedAt: decision.createdAt.toISOString() })),
    signatures: [],
  });
  const attestation = attestApprovedProjection(projection);
  const snapshot = await tx.workflowApprovedSnapshot.create({ data: { requestId: request.id, version: input.version, mode: "PHYSICAL", evidenceState: "CHO_KY", projection: json(projection), projectionSha256: computeApprovedProjectionSha256(projection), attestationKeyId: attestation.keyId, attestation: attestation.value } });
  await tx.workflowSigningLifecycle.update({ where: { requestId: request.id }, data: { snapshotId: snapshot.id } });
  return snapshot;
}
