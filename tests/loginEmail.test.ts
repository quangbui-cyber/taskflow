import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLoginEmail } from "../lib/loginEmail";

test("login email is trimmed and lower-cased", () => {
  assert.deepEqual(parseLoginEmail("  Quang.Bui@Example.COM "), { email: "quang.bui@example.com" });
});

test("empty, malformed and oversized login emails are rejected", () => {
  assert.deepEqual(parseLoginEmail("   "), { error: "Vui lòng nhập email mới." });
  assert.deepEqual(parseLoginEmail(null), { error: "Vui lòng nhập email mới." });
  for (const bad of ["no-at-sign", "a@b", "a b@example.com", "a@@example.com", "@example.com"]) {
    assert.deepEqual(parseLoginEmail(bad), { error: "Email không hợp lệ." }, bad);
  }
  assert.deepEqual(parseLoginEmail(`${"a".repeat(250)}@example.com`), { error: "Email không hợp lệ." });
});
