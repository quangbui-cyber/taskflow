import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { verifySignaturePinHash } from "../lib/workflow/signatureAssets";
import { assertSigningModeState } from "../lib/workflow/signing";
import { validatePhysicalScanBatch } from "../lib/workflow/lifecycle";
import { derivePublicVerificationToken, digestPublicVerificationToken } from "../lib/workflow/publicVerification";

test("six-digit signing PIN passes only for the correct secret", async () => {
  const hash = await bcrypt.hash("123456", 4);
  assert.equal(await verifySignaturePinHash(hash, "123456"), true);
  assert.equal(await verifySignaturePinHash(hash, "654321"), false);
  await assert.rejects(() => verifySignaturePinHash(hash, "12345"), /6 chữ số/);
});

test("mode isolation and scan magic-byte checks fail closed", () => {
  assert.doesNotThrow(() => assertSigningModeState("DIGITAL", "DIGITAL_CONFIRMED"));
  assert.doesNotThrow(() => assertSigningModeState("PHYSICAL", "PHYSICAL_CONFIRMED"));
  assert.throws(() => assertSigningModeState("DIGITAL", "PHYSICAL_CONFIRMED"), /chế độ ký/);
  assert.throws(() => validatePhysicalScanBatch([{ name: "fake.pdf", mimeType: "application/pdf", size: 5, data: Uint8Array.from(Buffer.from("<html")) }]), /đúng định dạng/);
});

test("public capability is opaque, key-bound and stores only a digest", () => {
  const previous = process.env.DOCUMENT_ATTESTATION_KEY_V1;
  process.env.DOCUMENT_ATTESTATION_KEY_V1 = "phase9-security-local-test-key";
  try {
    const token = derivePublicVerificationToken({ capabilityId: "cap", publicNonce: "n".repeat(43), snapshotDigest: "a".repeat(64), keyId: "v1" });
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(token, /cap|request|snapshot/);
    assert.match(digestPublicVerificationToken(token), /^[a-f0-9]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.DOCUMENT_ATTESTATION_KEY_V1;
    else process.env.DOCUMENT_ATTESTATION_KEY_V1 = previous;
  }
});

test("cash, public route and physical downloads re-authorize on the server", async () => {
  const cash = await readFile(new URL("../lib/costflow/paymentCash.ts", import.meta.url), "utf8");
  const publicVerifier = await readFile(new URL("../lib/workflow/publicVerification.ts", import.meta.url), "utf8");
  const download = await readFile(new URL("../app/api/workflow/physical-scans/[fileId]/route.ts", import.meta.url), "utf8");
  assert.match(cash, /signingLifecycle[\s\S]*DIGITAL_CONFIRMED[\s\S]*PHYSICAL_CONFIRMED/);
  assert.match(cash, /cashAssigneeId !== actor\.id/);
  assert.match(publicVerifier, /revokedAt \|\| capability\.replacedAt/);
  assert.match(publicVerifier, /computeApprovedProjectionSha256/);
  assert.match(download, /requireUser\(\)/);
  assert.match(download, /loadDocument/);
  assert.match(download, /private, no-store/);
});

test("public DTO and print projection exclude private signing material", async () => {
  const verifier = await readFile(new URL("../lib/workflow/publicVerification.ts", import.meta.url), "utf8");
  const dto = verifier.match(/export type PublicVerificationDto = \{[\s\S]*?\n\};/)?.[0] ?? "";
  for (const secret of ["signaturePngData", "signaturePinHash", "bankAccount", "signerIpNormalized", "payload", "files"]) assert.doesNotMatch(dto, new RegExp(secret, "i"));
  const print = await readFile(new URL("../lib/workflow/printDocument.ts", import.meta.url), "utf8");
  assert.match(print, /projectionSha256/);
  assert.match(print, /evidenceConfirmed/);
});
