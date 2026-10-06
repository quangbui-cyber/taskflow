import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canCancelLeave,
  canDecideLeave,
  countLeaveDays,
  leaveApproverIds,
  leaveDaysByMonth,
  leaveRangeError,
  parseLeaveDate,
  summarizeLeave,
  todayInVietnam,
} from "../lib/leave";

const d = (text: string) => parseLeaveDate(text)!;

test("leave dates must be real calendar dates", () => {
  assert.equal(d("2026-10-05").toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(parseLeaveDate("2026-02-30"), null);
  assert.equal(parseLeaveDate("05/10/2026"), null);
  assert.equal(parseLeaveDate(null), null);
});

test("today follows Vietnam time", () => {
  // 18:00 UTC ngày 4 đã là 01:00 ngày 5 ở Việt Nam
  assert.equal(
    todayInVietnam(new Date("2026-10-04T18:00:00Z")).toISOString().slice(0, 10),
    "2026-10-05"
  );
});

test("leave days count weekdays only, half days count 0.5", () => {
  // 05/10/2026 là Thứ Hai
  assert.equal(countLeaveDays(d("2026-10-05"), d("2026-10-05"), null), 1);
  assert.equal(countLeaveDays(d("2026-10-05"), d("2026-10-05"), "AM"), 0.5);
  assert.equal(countLeaveDays(d("2026-10-05"), d("2026-10-09"), null), 5);
  assert.equal(countLeaveDays(d("2026-10-09"), d("2026-10-12"), null), 2);
  assert.equal(countLeaveDays(d("2026-10-10"), d("2026-10-11"), null), 0);
});

test("invalid leave ranges are rejected with a reason", () => {
  const today = d("2026-10-05");
  assert.equal(leaveRangeError(d("2026-10-06"), d("2026-10-07"), null, today), null);
  assert.match(leaveRangeError(d("2026-10-07"), d("2026-10-06"), null, today)!, /kết thúc/);
  assert.match(leaveRangeError(d("2026-12-31"), d("2027-01-02"), null, today)!, /hai năm/);
  assert.match(leaveRangeError(d("2026-10-06"), d("2026-10-07"), "AM", today)!, /nửa ngày/);
  assert.match(leaveRangeError(d("2026-10-10"), d("2026-10-11"), null, today)!, /Thứ Bảy/);
  assert.match(leaveRangeError(d("2026-08-01"), d("2026-08-03"), null, today)!, /lùi/);
  assert.match(leaveRangeError(d("2026-10-06"), d("2026-12-30"), null, today)!, /tối đa/);
});

test("the direct manager decides; without one the leave-tab managers do", () => {
  const report = { id: "u1", managerId: "m1" };
  assert.ok(canDecideLeave({ id: "m1", isLeaveManager: false }, report));
  // Người đã có quản lý thì quản lý nghỉ phép không duyệt thay.
  assert.equal(canDecideLeave({ id: "h1", isLeaveManager: true }, report), false);
  assert.equal(canDecideLeave({ id: "m2", isLeaveManager: false }, report), false);

  const noManager = { id: "u2", managerId: null };
  assert.ok(canDecideLeave({ id: "h1", isLeaveManager: true }, noManager));
  assert.equal(canDecideLeave({ id: "m1", isLeaveManager: false }, noManager), false);
  // Không tự duyệt đơn của mình, kể cả khi là quản lý nghỉ phép.
  assert.equal(canDecideLeave({ id: "u2", isLeaveManager: true }, noManager), false);

  // Quản lý đã bị vô hiệu hoá coi như chưa có quản lý.
  const inactive = { id: "u3", managerId: "m9", managerActive: false };
  assert.ok(canDecideLeave({ id: "h1", isLeaveManager: true }, inactive));
  assert.equal(canDecideLeave({ id: "m9", isLeaveManager: false }, inactive), false);
});

test("approvers are the manager, otherwise the other leave-tab managers", () => {
  assert.deepEqual(leaveApproverIds({ id: "u1", managerId: "m1" }, ["h1"]), ["m1"]);
  assert.deepEqual(leaveApproverIds({ id: "u1", managerId: null }, ["h1", "h2"]), ["h1", "h2"]);
  assert.deepEqual(leaveApproverIds({ id: "h1", managerId: null }, ["h1", "h2"]), ["h2"]);
  assert.deepEqual(leaveApproverIds({ id: "h1", managerId: "h1" }, ["h1"]), []);
});

test("pending requests can be cancelled, approved ones only before they start", () => {
  const today = d("2026-10-05");
  assert.ok(canCancelLeave({ status: "PENDING", startDate: d("2026-10-01") }, today));
  assert.ok(canCancelLeave({ status: "APPROVED", startDate: d("2026-10-06") }, today));
  assert.equal(canCancelLeave({ status: "APPROVED", startDate: d("2026-10-05") }, today), false);
  assert.equal(canCancelLeave({ status: "REJECTED", startDate: d("2026-10-06") }, today), false);
});

test("only approved annual leave reduces the balance", () => {
  const summary = summarizeLeave(
    [
      { type: "ANNUAL", status: "APPROVED", days: 2 },
      { type: "ANNUAL", status: "APPROVED", days: 0.5 },
      { type: "ANNUAL", status: "PENDING", days: 3 },
      { type: "ANNUAL", status: "REJECTED", days: 5 },
      { type: "UNPAID", status: "APPROVED", days: 4 },
    ],
    12
  );
  assert.deepEqual(summary, { quota: 12, used: 2.5, pending: 3, remaining: 9.5 });
});

test("report splits a request across the months it spans", () => {
  // 29/10/2026 là Thứ Năm → 29, 30/10 và 02/11 là ngày làm việc
  assert.deepEqual(
    [...leaveDaysByMonth(d("2026-10-29"), d("2026-11-02"), null)],
    [[10, 2], [11, 1]]
  );
  assert.deepEqual([...leaveDaysByMonth(d("2026-10-05"), d("2026-10-05"), "PM")], [[10, 0.5]]);
  assert.deepEqual([...leaveDaysByMonth(d("2026-10-10"), d("2026-10-11"), null)], []);
  // Tổng theo tháng luôn khớp với số ngày của đơn.
  const split = leaveDaysByMonth(d("2026-03-25"), d("2026-04-08"), null);
  assert.equal(
    [...split.values()].reduce((sum, value) => sum + value, 0),
    countLeaveDays(d("2026-03-25"), d("2026-04-08"), null)
  );
});
