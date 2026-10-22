import assert from "node:assert/strict";
import { test } from "node:test";
import { sendGoogleChat } from "../lib/googleChat";
import { taskGoogleChatMessage, type TaskChatInput } from "../lib/taskGoogleChat";

const task: TaskChatInput = {
  event: "created", taskId: "task-1", projectName: "Jabil Pur",
  title: "Check bidding quà Trainer Day — Coupa #952409", status: "TODO",
  assigneeName: "Uyên Đỗ", actorName: "Duy Quang",
  dueDate: new Date("2026-10-23T09:00:00Z"),
  url: "https://mycreative.vercel.app/projects/project-1?task=task-1",
};

test("new task is a card with a Vietnam deadline and a direct open-job button", () => {
  const message = taskGoogleChatMessage(task);
  assert.equal(message.text, undefined, "don't duplicate the card as a text bubble");
  const card = message.cardsV2![0].card;
  assert.deepEqual(card.header, { title: "Jabil Pur", subtitle: "Công việc mới" });
  const body = JSON.stringify(card.sections[0]);
  for (const text of [task.title, "Uyên Đỗ", "Duy Quang", "23/10/2026", "16:00", "Cần làm"]) {
    assert.ok(body.includes(text), `missing ${text}`);
  }
  assert.deepEqual(card.sections[1].widgets, [{ buttonList: { buttons: [{
    text: "Mở job ↗", onClick: { openLink: { url: task.url } },
  }] } }]);
  assert.ok(message.fallbackText!.includes(task.url!));
  assert.ok(message.fallbackText!.includes(task.title));
});

test("status updates keep both colored states in the same card layout", () => {
  const message = taskGoogleChatMessage({ ...task, event: "status_changed", previousStatus: "TODO", status: "DONE" });
  assert.equal(message.cardsV2![0].card.header.subtitle, "Cập nhật trạng thái");
  assert.deepEqual(message.cardsV2![0].card.sections[0].widgets[1], {
    decoratedText: {
      topLabel: "Trạng thái", wrapText: true,
      text: '<b><font color="#b06000">● Cần làm</font></b> → <b><font color="#188038">✓ Hoàn thành</font></b>',
    },
  });
  assert.match(message.fallbackText!, /Cập nhật bởi: Duy Quang/);
});

test("recap-created tasks escape markup and support an unassigned task without a deadline or link", () => {
  const message = taskGoogleChatMessage({
    ...task, title: '<b>Task</b> & "quote"', actorName: "Anh <Quang>",
    meetingTitle: "Họp A & B", assigneeName: null, dueDate: null, url: null,
  });
  const widgets = message.cardsV2![0].card.sections[0].widgets;
  assert.deepEqual(widgets[0], { textParagraph: { text: "<b>&lt;b&gt;Task&lt;/b&gt; &amp; &quot;quote&quot;</b>" } });
  assert.ok(JSON.stringify(widgets).includes("Họp A &amp; B"));
  assert.ok(JSON.stringify(widgets).includes("Anh &lt;Quang&gt;"));
  assert.ok(message.fallbackText!.includes("Người phụ trách: Chưa giao"));
  assert.ok(!message.fallbackText!.includes("Hạn chót"));
  assert.equal(message.cardsV2![0].card.sections.length, 1);
});

test("assignee changes and in-progress tasks retain their labels", () => {
  const message = taskGoogleChatMessage({ ...task, event: "assignee_changed", status: "IN_PROGRESS" });
  assert.equal(message.cardsV2![0].card.header.subtitle, "Cập nhật người phụ trách");
  assert.match(message.fallbackText!, /Đang làm/);
});

test("webhook transport sends cards intact and still supports existing plain text callers", async (t) => {
  const sent: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response("{}", { status: 200 });
  });
  const message = taskGoogleChatMessage(task);
  assert.deepEqual(await sendGoogleChat("https://chat.googleapis.com/example", message), { ok: true });
  assert.deepEqual(await sendGoogleChat("https://chat.googleapis.com/example", "Connected"), { ok: true });
  assert.deepEqual(sent, [message, { text: "Connected" }]);
});
