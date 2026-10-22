import assert from "node:assert/strict";
import { test } from "node:test";
import { meetingsEnabled } from "../lib/features";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

test("meeting booking is on by default everywhere, including Vercel production", () => {
  assert.equal(meetingsEnabled(env({})), true);
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "production" })), true);
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "preview" })), true);
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "production", MEETINGS_ENABLED: "true" })), true);
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "production", MEETINGS_ENABLED: "" })), true);
});

test("meeting booking can still be switched off with MEETINGS_ENABLED", () => {
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "production", MEETINGS_ENABLED: "false" })), false);
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "production", MEETINGS_ENABLED: " FALSE " })), false);
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "preview", MEETINGS_ENABLED: "0" })), false);
  assert.equal(meetingsEnabled(env({ MEETINGS_ENABLED: "false" })), false);
});
