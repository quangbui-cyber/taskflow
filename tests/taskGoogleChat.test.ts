import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatDeadline,
  deadlineDigestChatMessage,
  taskCommentChatMessage,
  taskGoogleChatMessage,
  type TaskChatInput,
} from "../lib/taskGoogleChat";

const task: TaskChatInput = {
  event: "created", taskId: "task-1", projectName: "Jabil Pur",
  title: "Check bidding quà Trainer Day — Coupa #952409", status: "TODO",
  assigneeName: "Uyên Đỗ", actorName: "Duy Quang",
  dueDate: new Date("2026-10-23T09:00:00Z"),
  url: "https://mycreative.vercel.app/projects/project-1?task=task-1",
};

test("deadlines read as time, weekday and date in Vietnam time", () => {
  assert.equal(chatDeadline(new Date("2026-10-23T09:00:00Z")), "16:00 · Thứ Sáu 23/10/2026");
});

test("a new task card leads with what happened, then the task title, icons and a filled button", () => {
  const message = taskGoogleChatMessage(task);
  assert.ok(message.text && !message.text.includes(task.title), "a short friendly line sits above the card but never repeats the card");
  const card = message.cardsV2![0].card;
  assert.deepEqual(card.header, { title: "🆕 Công việc mới", subtitle: "Jabil Pur" });
  const widgets = card.sections[0].widgets;
  assert.deepEqual(widgets[0], { textParagraph: { text: `<b>${task.title}</b>` } });
  const body = JSON.stringify(widgets);
  for (const text of ["Uyên Đỗ", "Duy Quang", "16:00 · Thứ Sáu 23/10/2026", "Cần làm", '"knownIcon":"CLOCK"', '"knownIcon":"PERSON"']) {
    assert.ok(body.includes(text), `missing ${text}`);
  }
  assert.deepEqual(card.sections[1].widgets, [{ buttonList: { buttons: [{
    text: "Mở job", type: "FILLED", onClick: { openLink: { url: task.url } },
  }] } }]);
  assert.ok(message.fallbackText!.includes(task.url!));
  assert.ok(message.fallbackText!.includes(task.title));
});

test("finishing a task says so in the header and shows both colored states", () => {
  const message = taskGoogleChatMessage({ ...task, event: "status_changed", previousStatus: "IN_PROGRESS", status: "DONE" });
  assert.equal(message.cardsV2![0].card.header.title, "✅ Đã hoàn thành");
  assert.deepEqual(message.cardsV2![0].card.sections[0].widgets[1], {
    decoratedText: {
      startIcon: { knownIcon: "BOOKMARK" }, topLabel: "Trạng thái", wrapText: true,
      text: '<b><font color="#1a73e8">● Đang làm</font></b> → <b><font color="#188038">✓ Hoàn thành</font></b>',
    },
  });
  assert.match(message.fallbackText!, /Cập nhật bởi: Duy Quang/);
  assert.equal(taskGoogleChatMessage({ ...task, event: "status_changed", status: "IN_PROGRESS" }).cardsV2![0].card.header.title, "▶️ Bắt đầu làm");
});

test("a new assignee is shown first and in bold", () => {
  const message = taskGoogleChatMessage({ ...task, event: "assignee_changed", status: "IN_PROGRESS" });
  const card = message.cardsV2![0].card;
  assert.equal(card.header.title, "👤 Đổi người phụ trách");
  assert.deepEqual(card.sections[0].widgets[1], {
    decoratedText: { startIcon: { knownIcon: "PERSON" }, topLabel: "Người phụ trách mới", text: "<b>Uyên Đỗ</b>", wrapText: true },
  });
  assert.match(message.fallbackText!, /Đang làm/);
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

test("a comment card quotes the comment and links back to the task", () => {
  const message = taskCommentChatMessage({
    taskId: "task-1", projectName: "Jabil Pur", title: "In backdrop", authorName: "Hạnh",
    comment: "Chừa lề <5cm>\nGửi trước 15h", assigneeName: null, url: task.url,
  });
  const card = message.cardsV2![0].card;
  assert.deepEqual(card.header, { title: "💬 Hạnh bình luận", subtitle: "Jabil Pur" });
  assert.deepEqual(card.sections[0].widgets[1], { textParagraph: { text: "<i>“Chừa lề &lt;5cm&gt;<br>Gửi trước 15h”</i>" } });
  assert.match(JSON.stringify(card.sections[0].widgets[2]), /Chưa giao/);
  assert.equal(JSON.stringify(card.sections[1]).includes("Trả lời trong app"), true);
});

test("the daily digest groups overdue and due-today tasks, each opening its own task", () => {
  const now = new Date("2026-10-28T02:00:00Z");
  const message = deadlineDigestChatMessage({
    projectId: "p1", projectName: "Vietjet", baseUrl: "https://app.test", now,
    overdue: [{ id: "a", title: "Duyệt file in", assigneeName: "Hạnh", dueDate: new Date("2026-10-26T10:00:00Z") }],
    dueToday: [
      { id: "b", title: "In backdrop", assigneeName: null, dueDate: new Date("2026-10-28T10:00:00Z") },
    ],
  })!;
  const card = message.cardsV2![0].card;
  assert.equal(card.header.title, "⏰ Nhắc việc hôm nay");
  assert.equal(card.header.subtitle, "Vietjet · Thứ Tư 28/10");
  assert.equal(card.sections[0].header, "🔴 Quá hạn · 1 việc");
  assert.equal(card.sections[1].header, "🟡 Đến hạn hôm nay · 1 việc");
  assert.deepEqual(card.sections[1].widgets[0], {
    decoratedText: {
      text: '<font color="#1a73e8"><b>In backdrop</b></font>', bottomLabel: "Chưa giao · 17:00", wrapText: true,
      onClick: { openLink: { url: "https://app.test/projects/p1?task=b" } },
    },
  });
  assert.match(JSON.stringify(card.sections[2]), /Mở dự án/);
  assert.equal(deadlineDigestChatMessage({ projectId: "p", projectName: "x", baseUrl: "", overdue: [], dueToday: [] }), null);
});

test("long digests stop at 15 tasks per group and say how many are left", () => {
  const dueToday = Array.from({ length: 18 }, (_, index) => ({
    id: `t${index}`, title: `Việc ${index}`, assigneeName: "A", dueDate: new Date("2026-10-28T10:00:00Z"),
  }));
  const message = deadlineDigestChatMessage({ projectId: "p", projectName: "x", baseUrl: "", overdue: [], dueToday, now: new Date("2026-10-28T02:00:00Z") })!;
  const widgets = message.cardsV2![0].card.sections[0].widgets;
  assert.equal(widgets.length, 16);
  assert.match(JSON.stringify(widgets.at(-1)), /và 3 việc khác/);
});

test("every card carries a friendly line above it while the card itself stays formal", () => {
  const created = taskGoogleChatMessage(task);
  assert.ok(created.text && created.text.length > 0);
  assert.equal(created.cardsV2![0].card.header.title, "🆕 Công việc mới");
  assert.match(taskGoogleChatMessage({ ...task, event: "status_changed", status: "DONE" }).text!, /Xong|về đích/);
  assert.match(taskGoogleChatMessage({ ...task, event: "status_changed", status: "IN_PROGRESS" }).text!, /xắn tay áo|Bắt tay/);
  assert.equal(taskGoogleChatMessage(task).text, created.text);
  const comment = taskCommentChatMessage({ taskId: "t", projectName: "P", title: "T", authorName: "Hạnh", comment: "ok", assigneeName: null, url: null });
  assert.ok(comment.text);
  const digest = deadlineDigestChatMessage({
    projectId: "p", projectName: "x", baseUrl: "", overdue: [], now: new Date("2026-10-28T02:00:00Z"),
    dueToday: [{ id: "b", title: "In", assigneeName: null, dueDate: new Date("2026-10-28T10:00:00Z") }],
  })!;
  assert.match(digest.text!, /buổi sáng|Điểm danh/);
});
