import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("session module defers SESSION_SECRET validation until the runtime auth boundary", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;

  try {
    const session = await import(`../lib/session.ts?missing-secret=${Date.now()}`);
    await assert.rejects(session.getSession(), /Thiếu biến môi trường SESSION_SECRET/);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("session implementation never restores a known fallback secret", async () => {
  const source = await readFile(new URL("../lib/session.ts", import.meta.url), "utf8");
  assert.match(source, /function getSessionSecret\(\)/);
  assert.doesNotMatch(source, /\?\?\s*["']dev-secret["']/);
  assert.doesNotMatch(source, /const rawSecret = process\.env\.SESSION_SECRET;\s*\nif \(!rawSecret\)/);
});
