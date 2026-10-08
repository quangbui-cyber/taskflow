import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProfileName } from "../lib/profile";

test("profile names are trimmed, single-spaced, bounded and never empty", () => {
  assert.equal(normalizeProfileName("  Nguyễn   Văn A "), "Nguyễn Văn A");
  assert.equal(normalizeProfileName("A\nB\tC"), "A B C");
  assert.equal(normalizeProfileName("   "), null);
  assert.equal(normalizeProfileName(undefined), null);
  assert.equal(normalizeProfileName("x".repeat(200))?.length, 80);
});
