import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { derivePublicVerificationToken, digestPublicVerificationToken } from "../lib/workflow/publicVerification";

const input = {
  capabilityId: "capability-1",
  publicNonce: "n".repeat(43),
  snapshotDigest: "a".repeat(64),
  keyId: "v1",
};

test("public token is stable, opaque and issuer-authenticated", () => {
  const previous = process.env.DOCUMENT_ATTESTATION_KEY_V1;
  process.env.DOCUMENT_ATTESTATION_KEY_V1 = "phase9-local-test-only-key-change-me";
  try {
    const token = derivePublicVerificationToken(input);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(derivePublicVerificationToken(input), token);
    assert.match(digestPublicVerificationToken(token), /^[a-f0-9]{64}$/);
    process.env.DOCUMENT_ATTESTATION_KEY_V1 = "different-key";
    assert.notEqual(derivePublicVerificationToken(input), token);
    assert.throws(() => derivePublicVerificationToken({ ...input, keyId: "retired" }), /không được hỗ trợ/);
  } finally {
    if (previous === undefined) delete process.env.DOCUMENT_ATTESTATION_KEY_V1;
    else process.env.DOCUMENT_ATTESTATION_KEY_V1 = previous;
  }
});

test("schema stores only token digest, random nonce, key version and lifecycle timestamps", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const model = schema.match(/model WorkflowPublicVerificationCapability \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(model, /snapshotId\s+String\s+@unique/);
  assert.match(model, /publicNonce\s+String\s+@unique/);
  assert.match(model, /tokenDigest\s+String\s+@unique/);
  assert.match(model, /attestationKeyId\s+String/);
  assert.match(model, /revokedAt\s+DateTime\?/);
  assert.match(model, /replacedAt\s+DateTime\?/);
  assert.doesNotMatch(model, /\n\s*(?:token|plaintextToken)\s+String/);
});

test("public DTO is an explicit allowlist with no private dossier fields", async () => {
  const source = await readFile(new URL("../lib/workflow/publicVerification.ts", import.meta.url), "utf8");
  const dto = source.match(/export type PublicVerificationDto = \{[\s\S]*?\n\};/)?.[0] ?? "";
  for (const allowed of ["dossierCode", "templateName", "approvedAt", "requesterName", "amount", "signers", "digestShort"]) assert.match(dto, new RegExp(allowed));
  for (const forbidden of ["payload", "bankAccount", "bankName", "files", "signaturePngData", "signerIp", "reason", "notes", "membership"]) assert.doesNotMatch(dto, new RegExp(forbidden, "i"));
});

test("public route is token-based, dynamic, noindex and renders uniform invalid state", async () => {
  const page = await readFile(new URL("../app/workflow/verify/[token]/page.tsx", import.meta.url), "utf8");
  const card = await readFile(new URL("../components/workflow/PublicVerificationCard.tsx", import.meta.url), "utf8");
  assert.match(page, /params:\s*Promise<\{ token: string \}>/);
  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(page, /revalidate = 0/);
  assert.match(page, /index: false/);
  assert.doesNotMatch(card, /token|requestId|projectId|bankAccount|signaturePngData/);
  assert.match(card, /Không xác minh được hồ sơ/);
});

test("public verifier checks revocation, replacement, digest, HMAC and mode-specific confirmed evidence", async () => {
  const source = await readFile(new URL("../lib/workflow/publicVerification.ts", import.meta.url), "utf8");
  assert.match(source, /capability\.revokedAt \|\| capability\.replacedAt/);
  assert.match(source, /computeApprovedProjectionSha256/);
  assert.match(source, /verifyApprovedProjectionAttestation/);
  assert.match(source, /CREATOR.*MANAGER.*ACCOUNTANT.*CEO/);
  assert.match(source, /mode === "PHYSICAL"/);
  assert.match(source, /evidenceState !== "PHYSICAL_CONFIRMED"/);
  assert.match(source, /evidenceState !== "DIGITAL_CONFIRMED"/);
  assert.match(source, /WorkflowPublicVerificationRateLimit|workflowPublicVerificationRateLimit/);
  assert.doesNotMatch(source, /findUnique\(\{\s*where:\s*\{\s*requestId:/);
});
