import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type SigningMode = "DIGITAL" | "PHYSICAL";
export type SigningEvidenceState = "CHO_KY" | "DIGITAL_CONFIRMED" | "PENDING" | "RETURNED" | "PHYSICAL_CONFIRMED";
export type SignerIpSource = "DIRECT" | "TRUSTED_PROXY" | "UNAVAILABLE";

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
