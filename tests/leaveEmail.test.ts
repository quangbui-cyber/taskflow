import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLeaveEmail, type LeaveEmailEvent } from "../lib/leaveEmail";

const event: LeaveEmailEvent = {
  kind: "REQUESTED",
  requesterName: "Nhân viên thử",
  request: {
    type: "ANNUAL",
    startDate: new Date("2026-10-14T00:00:00Z"),
    endDate: new Date("2026-10-14T00:00:00Z"),
    halfDay: "AM",
    days: 0.5,
    reason: "Việc cá nhân",
  },
};

test("leave submission email includes date, half day, reason and pending status", () => {
  const email = buildLeaveEmail(event, "manager@example.test", "https://app.example.test");
  assert.deepEqual(email.to, ["manager@example.test"]);
  assert.match(email.text, /14\/10\/2026 \(buổi sáng\)/);
  assert.match(email.text, /0,5 ngày/);
  assert.match(email.text, /Lý do: Việc cá nhân/);
  assert.match(email.text, /Trạng thái: Chờ duyệt/);
  assert.match(email.html, /href="https:\/\/app.example.test\/leave"/);
  assert.equal(email.calendar, undefined);
});

test("approval, rejection and cancellation emails have distinct outcomes", () => {
  for (const [kind, expected] of [
    ["APPROVED", "đã được duyệt"],
    ["REJECTED", "bị từ chối"],
    ["CANCELLED", "đã được hủy"],
  ] as const) {
    const email = buildLeaveEmail({
      ...event, kind, actorName: "Quản lý", decisionNote: "Đã kiểm tra",
    }, "staff@example.test", "");
    assert.ok(email.subject.includes(expected));
    assert.ok(!email.text.includes("Chờ duyệt"));
    assert.ok(!email.html.includes("href="));
    if (kind !== "CANCELLED") {
      assert.match(email.text, /Người xử lý: Quản lý/);
      assert.match(email.text, /Ghi chú: Đã kiểm tra/);
    }
  }
});

test("leave email escapes user content and shows a multi-day unpaid range", () => {
  const email = buildLeaveEmail({
    ...event,
    requesterName: 'A <img src=x onerror="alert(1)">',
    request: {
      ...event.request,
      type: "UNPAID",
      endDate: new Date("2026-10-16T00:00:00Z"),
      halfDay: null,
      days: 3,
      reason: "<script>alert('test')</script> & nghỉ",
    },
  }, "staff@example.test", "https://app.example.test");
  assert.match(email.text, /14\/10\/2026 - 16\/10\/2026/);
  assert.match(email.text, /Nghỉ không lương/);
  assert.ok(!email.html.includes("<script>"));
  assert.ok(!email.html.includes("<img"));
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /&amp; nghỉ/);
});
