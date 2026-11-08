import assert from "node:assert/strict";
import { test } from "node:test";
import { creativeEnabled, financeEnabled, meetingsEnabled, crmEnabled } from "../lib/features";

const env = (values: Record<string, string | undefined>): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...values });

test("CRM is off unless explicitly enabled", () => {
  for (const flag of [undefined, "", "false", "0", "yes"]) assert.equal(crmEnabled(env({ CRM_ENABLED: flag })), false);
  for (const flag of ["true", " TRUE ", " 1 "]) assert.equal(crmEnabled(env({ CRM_ENABLED: flag })), true);
  assert.equal(crmEnabled(env({})), false);
});

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

test("finance and suppliers stay hidden unless FINANCE_ENABLED is turned on", () => {
  assert.equal(financeEnabled(env({})), false);
  assert.equal(financeEnabled(env({ VERCEL_ENV: "production" })), false);
  assert.equal(financeEnabled(env({ FINANCE_ENABLED: "false" })), false);
  assert.equal(financeEnabled(env({ FINANCE_ENABLED: "true" })), true);
  assert.equal(financeEnabled(env({ FINANCE_ENABLED: " TRUE " })), true);
  assert.equal(financeEnabled(env({ FINANCE_ENABLED: "1" })), true);
});

test("creative corner is on by default and can be turned off with CREATIVE_ENABLED", () => {
  assert.equal(creativeEnabled(env({})), true);
  assert.equal(creativeEnabled(env({ VERCEL_ENV: "production" })), true);
  assert.equal(creativeEnabled(env({ CREATIVE_ENABLED: "true" })), true);
  assert.equal(creativeEnabled(env({ CREATIVE_ENABLED: "false" })), false);
  assert.equal(creativeEnabled(env({ CREATIVE_ENABLED: " FALSE " })), false);
  assert.equal(creativeEnabled(env({ CREATIVE_ENABLED: "0" })), false);
});

