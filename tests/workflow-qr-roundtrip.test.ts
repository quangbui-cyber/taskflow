import assert from "node:assert/strict";
import { test } from "node:test";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { absolutePublicVerificationUrl, derivePublicVerificationToken, digestPublicVerificationToken } from "../lib/workflow/publicVerification";

test("maintained QR encoder round-trips the exact absolute opaque-capability URL", async () => {
  const previousKey = process.env.DOCUMENT_ATTESTATION_KEY_V1;
  process.env.DOCUMENT_ATTESTATION_KEY_V1 = "phase9-local-test-only-key-change-me";
  try {
    const capability = { id: "cap-qr-1", nonce: "n".repeat(43), snapshotDigest: "a".repeat(64), keyId: "v1" };
    const token = derivePublicVerificationToken({ capabilityId: capability.id, publicNonce: capability.nonce, snapshotDigest: capability.snapshotDigest, keyId: capability.keyId });
    const persistedDigest = digestPublicVerificationToken(token);
    assert.equal(persistedDigest, digestPublicVerificationToken(token));
    const url = absolutePublicVerificationUrl(token, "https://paperwork.example.vn");
    const png = PNG.sync.read(await QRCode.toBuffer(url, { errorCorrectionLevel: "M", margin: 4, width: 320, type: "png" }));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.ok(decoded, "QR decoder must recognize the generated PNG");
    assert.equal(decoded.data, url);
    assert.equal(url, `https://paperwork.example.vn/workflow/verify/${token}`);
  } finally {
    if (previousKey === undefined) delete process.env.DOCUMENT_ATTESTATION_KEY_V1;
    else process.env.DOCUMENT_ATTESTATION_KEY_V1 = previousKey;
  }
});

test("public origin fails closed outside HTTPS or local development", () => {
  assert.throws(() => absolutePublicVerificationUrl("a".repeat(43), "http://paperwork.example.vn"), /HTTPS/);
  assert.doesNotThrow(() => absolutePublicVerificationUrl("a".repeat(43), "http://localhost:3017"));
});
