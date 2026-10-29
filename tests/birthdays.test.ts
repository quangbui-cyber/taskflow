import assert from "node:assert/strict";
import test from "node:test";
import {
  birthdayCountdownLabel,
  canWishBirthday,
  daysSinceBirthday,
  daysUntilBirthday,
  formatBirthdayWithWeekday,
  parseBirthdayInput,
  upcomingBirthdays,
} from "../lib/birthdays";

const bd = (month: number, day: number) => new Date(Date.UTC(2000, month - 1, day));
// 27/10/2026 08:00 giờ Việt Nam
const now = new Date("2026-10-27T01:00:00Z");

test("days until birthday counts in Vietnam time and wraps to next year", () => {
  assert.equal(daysUntilBirthday(bd(10, 27), now), 0);
  assert.equal(daysUntilBirthday(bd(10, 30), now), 3);
  assert.equal(daysUntilBirthday(bd(10, 26), now), 364);
  // 23:30 ngày 26/10 UTC đã là 27/10 ở Việt Nam
  assert.equal(daysUntilBirthday(bd(10, 27), new Date("2026-10-26T17:30:00Z")), 0);
});

test("29 February is celebrated on 28 February in non-leap years", () => {
  const feb = new Date("2027-02-27T03:00:00Z");
  assert.equal(daysUntilBirthday(bd(2, 29), feb), 1);
});

test("wishes are allowed on the day and a few days after", () => {
  assert.equal(daysSinceBirthday(bd(10, 25), now), 2);
  assert.equal(canWishBirthday(bd(10, 27), now), true);
  assert.equal(canWishBirthday(bd(10, 24), now), true);
  assert.equal(canWishBirthday(bd(10, 23), now), false);
  assert.equal(canWishBirthday(bd(10, 28), now), false);
  assert.equal(canWishBirthday(null, now), false);
});

test("upcoming birthdays are limited to the next 30 days and sorted", () => {
  const people = [
    { name: "B", birthday: bd(11, 8) },
    { name: "A", birthday: bd(10, 27) },
    { name: "C", birthday: bd(12, 20) },
    { name: "D", birthday: null },
    { name: "E", birthday: bd(10, 30) },
  ];
  const result = upcomingBirthdays(people, now);
  assert.deepEqual(
    result.map((person) => [person.name, person.daysUntil]),
    [
      ["A", 0],
      ["E", 3],
      ["B", 12],
    ]
  );
  assert.equal(formatBirthdayWithWeekday(result[1].nextDate), "Thứ Sáu, 30/10");
});

test("birthday form input stores day and month only", () => {
  assert.deepEqual(parseBirthdayInput("", ""), { birthday: null });
  assert.deepEqual(parseBirthdayInput("29", "2"), {
    birthday: new Date(Date.UTC(2000, 1, 29)),
  });
  assert.ok("error" in parseBirthdayInput("31", "4"));
  assert.ok("error" in parseBirthdayInput("5", ""));
  assert.ok("error" in parseBirthdayInput("abc", "3"));
});

test("countdown labels", () => {
  assert.equal(birthdayCountdownLabel(0), "Hôm nay");
  assert.equal(birthdayCountdownLabel(1), "Ngày mai");
  assert.equal(birthdayCountdownLabel(12), "còn 12 ngày");
});
