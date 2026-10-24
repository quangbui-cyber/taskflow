import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysToKey,
  calendarWeekRange,
  formatWeekLabel,
  layoutOverlaps,
  minuteToTime,
  mondayOfKey,
  resolveCalendarWeek,
  vnMinuteOfDay,
} from "../lib/meetingCalendar";

test("any day of the week maps to its Monday, across month and year edges", () => {
  assert.equal(mondayOfKey("2026-10-28"), "2026-10-26");
  assert.equal(mondayOfKey("2026-10-26"), "2026-10-26");
  assert.equal(mondayOfKey("2026-11-01"), "2026-10-26");
  assert.equal(mondayOfKey("2027-01-02"), "2026-12-28");
  assert.equal(addDaysToKey("2026-12-31", 1), "2027-01-01");
});

test("the calendar opens on this week, or next week on a weekend, using Vietnam time", () => {
  // Thứ Năm 22/10 09:00 giờ VN
  assert.equal(resolveCalendarWeek(undefined, new Date("2026-10-22T02:00:00Z")), "2026-10-19");
  // Thứ Bảy 24/10 giờ VN → tuần sau
  assert.equal(resolveCalendarWeek(undefined, new Date("2026-10-24T02:00:00Z")), "2026-10-26");
  // 23:30 Chủ nhật UTC đã là Thứ Hai 06:30 giờ VN
  assert.equal(resolveCalendarWeek(undefined, new Date("2026-10-25T23:30:00Z")), "2026-10-26");
});

test("a ?week= value picks that week and bad values fall back to the current week", () => {
  const now = new Date("2026-10-22T02:00:00Z");
  assert.equal(resolveCalendarWeek("2026-11-05", now), "2026-11-02");
  assert.equal(resolveCalendarWeek("2026-02-31", now), "2026-10-19");
  assert.equal(resolveCalendarWeek("hello", now), "2026-10-19");
});

test("week range runs from Monday 00:00 to next Monday 00:00 Vietnam time", () => {
  const { start, end } = calendarWeekRange("2026-10-26");
  assert.equal(start.toISOString(), "2026-10-25T17:00:00.000Z");
  assert.equal(end.toISOString(), "2026-11-01T17:00:00.000Z");
});

test("labels and minute helpers read Vietnam time", () => {
  assert.equal(formatWeekLabel("2026-10-26", 5), "26/10 – 30/10/2026");
  assert.equal(formatWeekLabel("2026-12-28", 7), "28/12/2026 – 03/01/2027");
  assert.equal(vnMinuteOfDay(new Date("2026-10-26T02:30:00Z")), 9 * 60 + 30);
  assert.equal(minuteToTime(9 * 60 + 30), "09:30");
  assert.equal(minuteToTime(24 * 60), "23:30");
});

test("meetings at the same time in different rooms sit side by side", () => {
  const laid = layoutOverlaps([
    { id: "a", startMin: 540, endMin: 600 },
    { id: "b", startMin: 570, endMin: 630 },
    { id: "c", startMin: 600, endMin: 660 },
    { id: "d", startMin: 720, endMin: 780 },
  ]);
  const byId = Object.fromEntries(laid.map((item) => [item.id, item]));
  assert.deepEqual([byId.a.column, byId.a.columns], [0, 2]);
  assert.deepEqual([byId.b.column, byId.b.columns], [1, 2]);
  // c bắt đầu đúng lúc a kết thúc nên dùng lại cột của a
  assert.deepEqual([byId.c.column, byId.c.columns], [0, 2]);
  // d không trùng ai nên chiếm trọn chiều ngang
  assert.deepEqual([byId.d.column, byId.d.columns], [0, 1]);
});
