import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import {
  assertPinnedPhase9DatabaseUrl,
  decodeSignaturePngDataUrl,
  verifySignaturePinHash,
} from "../lib/workflow/signatureAssets";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("signature image accepts a decoded PNG and records bounded dimensions", () => {
  const parsed = decodeSignaturePngDataUrl(ONE_PIXEL_PNG);
  assert.equal(parsed.width, 1);
  assert.equal(parsed.height, 1);
  assert.equal(parsed.bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(parsed.sha256, /^[a-f0-9]{64}$/);
});

test("signature image rejects SVG, prefix spoofing, trailing polyglot data and oversize bytes", () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.throws(
    () => decodeSignaturePngDataUrl(`data:image/svg+xml;base64,${svg.toString("base64")}`),
    /PNG/i
  );
  assert.throws(
    () => decodeSignaturePngDataUrl(`data:image/png;base64,${svg.toString("base64")}`),
    /PNG/i
  );

  const png = Buffer.from(ONE_PIXEL_PNG.split(",")[1], "base64");
  const polyglot = Buffer.concat([png, Buffer.from("<script>alert(1)</script>")]);
  assert.throws(
    () => decodeSignaturePngDataUrl(`data:image/png;base64,${polyglot.toString("base64")}`),
    /PNG/i
  );

  const oversized = Buffer.alloc(128 * 1024 + 1);
  oversized.set(Buffer.from("89504e470d0a1a0a", "hex"));
  assert.throws(
    () => decodeSignaturePngDataUrl(`data:image/png;base64,${oversized.toString("base64")}`),
    /128 KiB/i
  );
});

test("signature PIN contract requires exactly six digits and compares bcrypt hashes", async () => {
  const hash = await bcrypt.hash("123456", 4);
  assert.equal(await verifySignaturePinHash(hash, "123456"), true);
  assert.equal(await verifySignaturePinHash(hash, "654321"), false);
  await assert.rejects(() => verifySignaturePinHash(hash, "12345"), /6 chữ số/);
  await assert.rejects(() => verifySignaturePinHash(hash, "abcdef"), /6 chữ số/);
});

test("phase 9 migration guard fails closed before any database write", () => {
  assert.doesNotThrow(() =>
    assertPinnedPhase9DatabaseUrl("postgresql://postgres@127.0.0.1:55439/taskflow")
  );
  assert.throws(
    () => assertPinnedPhase9DatabaseUrl("postgresql://postgres@127.0.0.1:5432/taskflow"),
    /127\.0\.0\.1:55439\/taskflow/
  );
});

test("schema keeps signature bytes outside User and defines owner/audit boundaries", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const userModel = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(userModel, /signaturePinHash\s+String\?/);
  assert.doesNotMatch(userModel, /signatureData/);
  assert.match(schema, /model WorkflowSignatureAsset \{/);
  assert.match(schema, /ownerId\s+String\s+@unique/);
  assert.match(schema, /model WorkflowSignatureAssetAudit \{/);
  assert.match(schema, /action\s+String/);
  assert.doesNotMatch(
    schema.match(/model WorkflowSignatureAssetAudit \{[\s\S]*?\n\}/)?.[0] ?? "",
    /(?:data|bytes)\s+Bytes/
  );
});

test("profile actions derive ownership from requireUser and never accept a target user id", async () => {
  const actions = await readFile(new URL("../app/actions/profile.ts", import.meta.url), "utf8");
  assert.match(actions, /saveOwnSignature/);
  assert.match(actions, /deleteOwnSignature/);
  assert.match(actions, /updateSignaturePin/);
  assert.match(actions, /await requireUser\(\)/);
  assert.doesNotMatch(actions, /formData\.get\(["']userId["']\)/);
  assert.match(actions, /bcrypt\.compare\(currentPassword,\s*account\.passwordHash\)/);
});

test("general session projection does not disclose signature assets or PIN hash", async () => {
  const auth = await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8");
  const projection = auth.match(/select:\s*\{[\s\S]*?\}/)?.[0] ?? "";
  assert.doesNotMatch(projection, /signature/i);
  assert.doesNotMatch(projection, /passwordHash/);
});
