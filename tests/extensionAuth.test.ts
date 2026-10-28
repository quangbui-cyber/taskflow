import assert from "node:assert/strict";
import { test } from "node:test";
import { extractBearerToken, generateRawToken, hashToken } from "../lib/extensionAuth";

test("generateRawToken produces token starting with mcr_ and has high entropy", () => {
  const t1 = generateRawToken();
  const t2 = generateRawToken();
  assert.ok(t1.startsWith("mcr_"));
  assert.equal(t1.length, 68); // "mcr_" + 64 hex characters (32 bytes)
  assert.notEqual(t1, t2);
});

test("hashToken generates consistent sha256 hash", () => {
  const token = "mcr_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const h1 = hashToken(token);
  const h2 = hashToken(token);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.notEqual(hashToken(token + "1"), h1);
});

test("extractBearerToken extracts token from header or raw string", () => {
  assert.equal(extractBearerToken("Bearer mcr_abc123"), "mcr_abc123");
  assert.equal(extractBearerToken("  Bearer   mcr_abc123  "), "mcr_abc123");
  assert.equal(extractBearerToken("mcr_abc123"), "mcr_abc123");
  assert.equal(extractBearerToken(""), null);
  assert.equal(extractBearerToken(null), null);
  assert.equal(extractBearerToken("Bearer other_prefix"), null);
  assert.equal(extractBearerToken("Basic abc"), null);
});
