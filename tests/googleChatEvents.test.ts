import assert from "node:assert/strict";
import test from "node:test";
import { chatEventKind, chatEventReply, googleProjectNumber, verifyChatEventRequest } from "../lib/googleChatEvents";

test("the Cloud project number comes from the OAuth client id", () => {
  assert.equal(googleProjectNumber({ GOOGLE_CLIENT_ID: "723564408506-abc.apps.googleusercontent.com" }), "723564408506");
  assert.equal(googleProjectNumber({ GOOGLE_CLOUD_PROJECT_NUMBER: "42", GOOGLE_CLIENT_ID: "1-x" }), "42");
  assert.equal(googleProjectNumber({}), null);
});

test("Chat events are recognised in both the Chat app and add-on formats", () => {
  assert.equal(chatEventKind({ type: "ADDED_TO_SPACE" }), "added");
  assert.equal(chatEventKind({ chat: { addedToSpacePayload: {} } }), "added");
  assert.equal(chatEventKind({ chat: { messagePayload: {} } }), "message");
  assert.equal(chatEventKind({ type: "REMOVED_FROM_SPACE" }), "other");
  assert.deepEqual(chatEventReply({ type: "REMOVED_FROM_SPACE" }), {});
  assert.match(JSON.stringify(chatEventReply({ type: "ADDED_TO_SPACE" })), /MyCreative/);
  assert.ok("hostAppDataAction" in chatEventReply({ chat: { messagePayload: {} } }));
});

test("requests without a valid Google token are rejected", async () => {
  assert.equal(await verifyChatEventRequest(null, "https://app.test/api/google/chat/events"), false);
  assert.equal(await verifyChatEventRequest("Bearer not-a-jwt", "https://app.test/api/google/chat/events"), false);
});
