import assert from "node:assert/strict";
import { test } from "node:test";
import { meetingsEnabled } from "../lib/features";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

test("meeting booking is hidden on Vercel production unless switched on", () => {
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "production" })), false);
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "production", MEETINGS_ENABLED: "true" })), true);
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "production", MEETINGS_ENABLED: " TRUE " })), true);
});

test("meeting booking stays on for local dev and previews, and can be forced off", () => {
  assert.equal(meetingsEnabled(env({})), true);
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "preview" })), true);
  assert.equal(meetingsEnabled(env({ MEETINGS_ENABLED: "false" })), false);
  assert.equal(meetingsEnabled(env({ VERCEL_ENV: "preview", MEETINGS_ENABLED: "0" })), false);
});
