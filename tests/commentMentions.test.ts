import assert from "node:assert/strict";
import test from "node:test";
import { mentionQuery, parseCommentMentions, updateCommentMentions } from "../lib/commentMentions";

test("same display names retain different selected user identities", () => {
  const body = "@Lan và @Lan";
  const mentions = [
    { userId: "lan-a", name: "Lan", start: 0, end: 4 },
    { userId: "lan-b", name: "Lan", start: 8, end: 12 },
  ];
  assert.deepEqual(parseCommentMentions(mentions, body), mentions);
  assert.deepEqual(parseCommentMentions([], body), []);
});

test("editing before a tag moves its range without changing the recipient", () => {
  const mention = { userId: "lan-a", name: "Lan", start: 0, end: 4 };
  assert.deepEqual(updateCommentMentions("@Lan giúp nhé", "Chào @Lan giúp nhé", [mention]), [
    { ...mention, start: 5, end: 9 },
  ]);
});

test("editing or deleting a selected tag removes its notification identity", () => {
  const mention = { userId: "lan-a", name: "Lan", start: 0, end: 4 };
  assert.deepEqual(updateCommentMentions("@Lan giúp nhé", "@La giúp nhé", [mention]), []);
  assert.deepEqual(updateCommentMentions("@Lan giúp nhé", "giúp nhé", [mention]), []);
});

test("invalid ranges and overlapping tags cannot turn unrelated text into a mention", () => {
  const mention = { userId: "lan-a", name: "Lan", start: 0, end: 4 };
  assert.deepEqual(parseCommentMentions([{ ...mention, end: 999 }, { ...mention, name: "An" }], "@Lan"), []);
  assert.deepEqual(parseCommentMentions([mention, mention], "@Lan"), [mention]);
});

test("typing an email does not open the mention picker", () => {
  assert.equal(mentionQuery("test@example.com", 16), null);
  assert.deepEqual(mentionQuery("Chào @Lan", 9), { start: 5, end: 9, query: "Lan" });
});
