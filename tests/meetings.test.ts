import assert from "node:assert/strict";
import test from "node:test";
import { buildMeetingIcs } from "../lib/meetingIcs";
import {
  MEETING_TIME_SLOTS,
  findFreeMeetingSlots,
  formatMeetingWhen,
  isMeetingTimeSlot,
  meetingConflicts,
  presetMeetingAttendees,
  rangesOverlap,
  vnDateTimeToUtc,
  vnDayRange,
} from "../lib/meetings";

const at = (iso: string) => new Date(iso);

test("Vietnam date and time convert to the matching UTC instant", () => {
  assert.equal(vnDateTimeToUtc("2026-10-12", "09:30")?.toISOString(), "2026-10-12T02:30:00.000Z");
  // 00:00–06:59 giờ VN rơi vào ngày hôm trước theo UTC
  assert.equal(vnDateTimeToUtc("2026-10-12", "06:00")?.toISOString(), "2026-10-11T23:00:00.000Z");
});

test("malformed or impossible dates are rejected instead of rolling over", () => {
  assert.equal(vnDateTimeToUtc("2026-02-31", "09:00"), null);
  assert.equal(vnDateTimeToUtc("2026-10-12", "24:00"), null);
  assert.equal(vnDateTimeToUtc("12/10/2026", "09:00"), null);
  assert.equal(vnDateTimeToUtc("2026-10-12", "9:00"), null);
});

test("back-to-back meetings do not clash but any shared minute does", () => {
  const nine = at("2026-10-12T02:00:00Z");
  const ten = at("2026-10-12T03:00:00Z");
  const eleven = at("2026-10-12T04:00:00Z");
  assert.equal(rangesOverlap(nine, ten, ten, eleven), false);
  assert.equal(rangesOverlap(ten, eleven, nine, ten), false);
  assert.equal(rangesOverlap(nine, eleven, ten, eleven), true);
  assert.equal(rangesOverlap(nine, eleven, at("2026-10-12T02:30:00Z"), at("2026-10-12T02:45:00Z")), true);
});

test("the Vietnam day range covers local midnight to midnight", () => {
  const range = vnDayRange(at("2026-10-12T18:30:00Z")); // 01:30 ngày 13/10 giờ VN
  assert.equal(range.start.toISOString(), "2026-10-12T17:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-10-13T17:00:00.000Z");
});

test("meeting time is described in Vietnam time", () => {
  assert.equal(
    formatMeetingWhen(at("2026-10-12T02:00:00Z"), at("2026-10-12T03:30:00Z")),
    "09:00 – 10:30, Thứ Hai, 12/10/2026"
  );
});

test("meeting times are limited to the hour and half-hour marks", () => {
  assert.equal(MEETING_TIME_SLOTS.length, 48);
  assert.equal(MEETING_TIME_SLOTS[0], "00:00");
  assert.equal(MEETING_TIME_SLOTS[19], "09:30");
  assert.equal(MEETING_TIME_SLOTS.at(-1), "23:30");
  assert.ok(MEETING_TIME_SLOTS.every(isMeetingTimeSlot));
  for (const time of ["09:15", "09:59", "24:00", "9:30", "09:30:00", ""]) {
    assert.equal(isMeetingTimeSlot(time), false, time);
  }
});

const meeting = {
  id: "abc123",
  title: "Họp kick-off; dự án A, B",
  description: "Dòng 1\nDòng 2",
  location: "Phòng họp tầng 3",
  url: "https://meet.example.com/abc",
  startAt: at("2026-10-12T02:00:00Z"),
  endAt: at("2026-10-12T03:00:00Z"),
  sequence: 2,
  organizer: { name: "Lan (myCreative)", email: "app@example.com" },
  attendees: [
    { name: "Lan", email: "lan@example.com", accepted: true },
    { name: 'Minh "PM"', email: "minh@example.com" },
  ],
};

function unfold(ics: string) {
  return ics.replace(/\r\n /g, "").split("\r\n");
}

test("an invite carries the event identity, UTC times and escaped text", () => {
  const lines = unfold(buildMeetingIcs(meeting, "REQUEST", at("2026-10-07T01:00:00Z")));
  assert.ok(lines.includes("METHOD:REQUEST"));
  assert.ok(lines.includes("UID:meeting-abc123@mycreative"));
  assert.ok(lines.includes("SEQUENCE:2"));
  assert.ok(lines.includes("DTSTAMP:20261007T010000Z"));
  assert.ok(lines.includes("DTSTART:20261012T020000Z"));
  assert.ok(lines.includes("DTEND:20261012T030000Z"));
  assert.ok(lines.includes("SUMMARY:Họp kick-off\\; dự án A\\, B"));
  assert.ok(lines.includes("DESCRIPTION:Dòng 1\\nDòng 2"));
  assert.ok(lines.includes("STATUS:CONFIRMED"));
  assert.ok(lines.includes('ORGANIZER;CN="Lan (myCreative)":mailto:app@example.com'));
  assert.ok(lines.some((line) => line.includes("PARTSTAT=ACCEPTED") && line.endsWith("mailto:lan@example.com")));
  // Dấu nháy kép trong tên không được làm vỡ tham số CN
  assert.ok(lines.some((line) => line.includes('CN="Minh  PM"') && line.endsWith("mailto:minh@example.com")));
  assert.ok(lines.includes("BEGIN:VALARM"));
});

test("a cancellation keeps the same UID so calendars remove the right event", () => {
  const lines = unfold(buildMeetingIcs({ ...meeting, sequence: 3 }, "CANCEL"));
  assert.ok(lines.includes("METHOD:CANCEL"));
  assert.ok(lines.includes("UID:meeting-abc123@mycreative"));
  assert.ok(lines.includes("SEQUENCE:3"));
  assert.ok(lines.includes("STATUS:CANCELLED"));
  assert.ok(!lines.includes("BEGIN:VALARM"));
});

test("long Vietnamese lines fold within 75 octets without splitting characters", () => {
  const long = { ...meeting, description: "Chuẩn bị tài liệu và số liệu doanh thu quý ".repeat(8) };
  const ics = buildMeetingIcs(long, "REQUEST");
  const encoder = new TextEncoder();
  for (const line of ics.split("\r\n")) {
    assert.ok(encoder.encode(line).length <= 75, `line too long: ${line}`);
  }
  assert.ok(!ics.includes("�"));
  assert.ok(unfold(ics).includes(`DESCRIPTION:${long.description}`));
});

test("project members are preselected only when active, without the organizer or duplicates", () => {
  const active = ["organizer", "an", "binh"];
  assert.deepEqual(
    presetMeetingAttendees(["an", "organizer", "disabled", "binh", "an"], active, "organizer"),
    ["an", "binh"]
  );
  assert.deepEqual(presetMeetingAttendees([], active, "organizer"), []);
});

import { expandRecurrence } from "../lib/meetingRecurrence";

test("weekly series lists every matching weekday from the start date", () => {
  const result = expandRecurrence("2026-11-09", {
    frequency: "weekly",
    weekdays: [0],
    end: { type: "count", count: 4 },
  });
  assert.deepEqual("dates" in result && result.dates, [
    "2026-11-09",
    "2026-11-16",
    "2026-11-23",
    "2026-11-30",
  ]);
});

test("daily series skips weekends and biweekly skips alternate weeks", () => {
  const daily = expandRecurrence("2026-11-06", {
    frequency: "daily",
    weekdays: [],
    end: { type: "count", count: 3 },
  });
  assert.deepEqual("dates" in daily && daily.dates, ["2026-11-06", "2026-11-09", "2026-11-10"]);

  const biweekly = expandRecurrence("2026-11-09", {
    frequency: "biweekly",
    weekdays: [0],
    end: { type: "date", until: "2026-12-07" },
  });
  assert.deepEqual("dates" in biweekly && biweekly.dates, ["2026-11-09", "2026-11-23", "2026-12-07"]);
});

test("monthly series keeps the day of month and skips months without it", () => {
  const result = expandRecurrence("2026-01-31", {
    frequency: "monthly",
    weekdays: [],
    end: { type: "count", count: 3 },
  });
  assert.deepEqual("dates" in result && result.dates, ["2026-01-31", "2026-03-31", "2026-05-31"]);
});

test("recurrence limits are enforced with Vietnamese errors", () => {
  const tooMany = expandRecurrence("2026-11-09", {
    frequency: "weekly",
    weekdays: [0],
    end: { type: "count", count: 99 },
  });
  assert.ok("error" in tooMany);
  const tooLong = expandRecurrence("2026-11-09", {
    frequency: "weekly",
    weekdays: [0],
    end: { type: "date", until: "2028-01-01" },
  });
  assert.ok("error" in tooLong);
  const single = expandRecurrence("2026-11-09", {
    frequency: "weekly",
    weekdays: [0],
    end: { type: "date", until: "2026-11-10" },
  });
  assert.ok("error" in single);
});

test("free slot search keeps the duration and skips busy ranges", () => {
  const vn = (time: string, date = "2026-11-12") => vnDateTimeToUtc(date, time)!;
  const slots = findFreeMeetingSlots({
    date: "2026-11-12",
    startTime: "14:00",
    endTime: "15:00",
    busy: [
      { startAt: vn("13:30"), endAt: vn("15:00") },
      { startAt: vn("15:00"), endAt: vn("15:30") },
    ],
    now: vn("08:00"),
  });
  assert.deepEqual(slots, [
    { date: "2026-11-12", startTime: "15:30", endTime: "16:30" },
    { date: "2026-11-12", startTime: "16:00", endTime: "17:00" },
  ]);
});

test("free slot search stays inside work hours and moves to the next workday", () => {
  // Thứ Sáu 13/11, 16:30–18:00 kín → sang Thứ Hai 16/11 từ 08:00
  const slots = findFreeMeetingSlots({
    date: "2026-11-13",
    startTime: "16:00",
    endTime: "17:30",
    busy: [{ startAt: vnDateTimeToUtc("2026-11-13", "16:30")!, endAt: vnDateTimeToUtc("2026-11-13", "18:00")! }],
    now: vnDateTimeToUtc("2026-11-13", "09:00")!,
  });
  assert.deepEqual(slots, [
    { date: "2026-11-16", startTime: "08:00", endTime: "09:30" },
    { date: "2026-11-16", startTime: "08:30", endTime: "10:00" },
  ]);
});

test("free slot search never suggests a time that already passed", () => {
  const slots = findFreeMeetingSlots({
    date: "2026-11-12",
    startTime: "09:00",
    endTime: "10:00",
    busy: [],
    now: vnDateTimeToUtc("2026-11-12", "11:10")!,
    limit: 1,
  });
  assert.deepEqual(slots, [{ date: "2026-11-12", startTime: "11:30", endTime: "12:30" }]);
});

test("conflicts only count meetings still on the calendar, back-to-back ones are not", () => {
  const m = (id: string, start: string, end: string) => ({
    id,
    title: id,
    startAt: vnDateTimeToUtc("2026-11-12", start)!,
    endAt: vnDateTimeToUtc("2026-11-12", end)!,
  });
  const a = m("a", "14:00", "15:00");
  const b = m("b", "14:30", "15:30");
  const declined = m("declined", "14:00", "15:00");
  const c = m("c", "15:30", "16:00");
  const result = meetingConflicts([a, b, declined, c], [a, b, c]);
  assert.deepEqual(result.get("a")?.map((x) => x.id), ["b"]);
  assert.deepEqual(result.get("b")?.map((x) => x.id), ["a"]);
  // Lời mời đã từ chối vẫn biết mình trùng với cuộc nào
  assert.deepEqual(result.get("declined")?.map((x) => x.id), ["a", "b"]);
  assert.equal(result.has("c"), false);
});
