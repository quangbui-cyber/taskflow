import assert from "node:assert/strict";
import { test } from "node:test";
import { newRecapSuggestions, publishedActionProgress, publishedRecapExport, readPublishedRecap, type RecapActionItemView } from "../lib/recapPublication";

const item: RecapActionItemView = {
  id: "item", title: "Việc đã gửi", owner: { id: "guest", name: "Người tham dự", avatarUrl: null },
  ownerName: null, dueDate: "2026-10-23", dueText: null, done: false, task: null,
};

test("attendees keep published fields while draft edits and new items stay private", () => {
  const snapshot = { content: "Nội dung đã gửi", actionItems: [item] };
  const live = [{ ...item, title: "Bản nháp bí mật", owner: null, dueDate: "2026-12-01", done: true }, { ...item, id: "new-draft-item" }];
  assert.deepEqual(publishedActionProgress(snapshot, live), [{ ...item, done: true }]);
  assert.equal(snapshot.actionItems[0].done, false);
  const exported = publishedRecapExport(snapshot);
  assert.match(exported, /Nội dung đã gửi/);
  assert.match(exported, /Việc đã gửi/);
  assert.doesNotMatch(exported, /Bản nháp bí mật/);
  assert.equal(readPublishedRecap(null), null);
});

test("published task progress updates without exposing tasks linked only in the draft", () => {
  const task = { id: "task", status: "TODO", projectId: "project", projectName: "Dự án" };
  const snapshot = { content: "Đã gửi", actionItems: [{ ...item, task }] };
  const live = [{ ...item, done: true, task: { ...task, status: "DONE", projectName: "Đã đổi" } }];
  assert.deepEqual(publishedActionProgress(snapshot, live)[0], { ...item, done: true, task: { ...task, status: "DONE" } });
  assert.equal(publishedActionProgress({ ...snapshot, actionItems: [item] }, live)[0].task, null);
  assert.deepEqual(publishedActionProgress(snapshot, []), snapshot.actionItems);
});

test("rewrite suggestions omit existing and repeated titles without changing the original rows", () => {
  const row = { order: 0, title: "  Gửi  báo giá ", ownerId: null, ownerName: "Lan", dueDate: new Date("2026-10-23T10:00:00Z"), dueText: null };
  const existing = [{ title: "GỬI BÁO GIÁ" }];
  let counter = 0;
  const result = newRecapSuggestions([row, { ...row, title: "Việc mới" }, { ...row, title: "VIỆC MỚI" }], existing, () => String(++counter));
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Việc mới");
  assert.equal(result[0].dueDate, "2026-10-23T10:00:00.000Z");
  assert.deepEqual(existing, [{ title: "GỬI BÁO GIÁ" }]);
});
