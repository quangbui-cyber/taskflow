import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET ??= "test-session-secret-for-google-meet-tokens";

test("Google Meet refresh tokens round-trip and are not stored in plain text", async () => {
  const { encryptToken, decryptToken } = await import("../lib/googleMeet");
  const stored = encryptToken("1//refresh-token-value");
  assert.ok(!stored.includes("refresh-token-value"));
  assert.notEqual(stored, encryptToken("1//refresh-token-value"));
  assert.equal(decryptToken(stored), "1//refresh-token-value");
});

test("tampered or foreign Google Meet tokens are rejected", async () => {
  const { encryptToken, decryptToken } = await import("../lib/googleMeet");
  const [version, iv, tag, data] = encryptToken("secret").split(".");
  const flipped = data.slice(0, -1) + (data.endsWith("A") ? "B" : "A");
  assert.equal(decryptToken([version, iv, tag, flipped].join(".")), null);
  assert.equal(decryptToken("plain-token"), null);
  assert.equal(decryptToken(""), null);
});

test("Google Meet sign-in attempt asks only for the Meet scope with offline access", async () => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  const { newGoogleMeetAttempt, verifyGoogleMeetAttempt, GOOGLE_MEET_SCOPE } = await import("../lib/googleMeet");
  const { authorizationUrl, cookie } = await newGoogleMeetAttempt("user-1", "http://localhost:3000/api/google/meet/callback");
  const params = authorizationUrl.searchParams;
  assert.equal(params.get("scope"), GOOGLE_MEET_SCOPE);
  assert.equal(params.get("access_type"), "offline");
  assert.equal(params.get("code_challenge_method"), "S256");
  const attempt = await verifyGoogleMeetAttempt(cookie);
  assert.equal(attempt.userId, "user-1");
  assert.equal(attempt.state, params.get("state"));
});
