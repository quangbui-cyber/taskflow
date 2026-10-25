import assert from "node:assert/strict";
import test from "node:test";
import { chatMemberEmails, chatSpaceDisplayName, isChatSpaceName } from "../lib/googleChatSpace";
import { canManageChatSpaces, canSendGmail, safeReturnPath } from "../lib/googleWorkspace";

test("the chat group is named after the project and fits Google's limit", () => {
  assert.equal(chatSpaceDisplayName("  Annual   Report TechWave 2026 "), "Annual Report TechWave 2026");
  assert.equal(chatSpaceDisplayName("Jabil", "a1b2c3"), "Jabil (a1b2c3)");
  const long = chatSpaceDisplayName("x".repeat(300), "a1b2c3");
  assert.equal(long.length, 128);
  assert.ok(long.endsWith("(a1b2c3)"));
  assert.equal(chatSpaceDisplayName("   "), "Dự án");
});

test("members are deduplicated and the creator is left out", () => {
  assert.deepEqual(
    chatMemberEmails(["Lan@Creativestation.vn", "lan@creativestation.vn", "ha@creativestation.vn", "bad", "a/b@x.vn"], "HA@creativestation.vn"),
    ["lan@creativestation.vn"],
  );
});

test("only real space names are accepted", () => {
  assert.ok(isChatSpaceName("spaces/AAAAbcd_12-x"));
  assert.ok(!isChatSpaceName("spaces/../users/me"));
  assert.ok(!isChatSpaceName("users/abc"));
});

test("permissions are read from the scopes the person allowed", () => {
  const gmail = "https://www.googleapis.com/auth/gmail.send";
  const chat = ["https://www.googleapis.com/auth/chat.spaces.create", "https://www.googleapis.com/auth/chat.memberships"];
  assert.ok(canSendGmail([gmail]));
  assert.ok(!canManageChatSpaces([gmail, chat[0]]));
  assert.ok(canManageChatSpaces(chat));
});

test("the return page after connecting stays inside the app", () => {
  assert.equal(safeReturnPath("/projects/abc?tab=webhook"), "/projects/abc?tab=webhook");
  assert.equal(safeReturnPath("https://evil.example"), "/profile");
  assert.equal(safeReturnPath("//evil.example"), "/profile");
  assert.equal(safeReturnPath("/\\evil.example"), "/profile");
  assert.equal(safeReturnPath(null), "/profile");
});
