import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countWords,
  decodeHtmlEntities,
  estimateReadingMinutes,
  getWeekdaySchedule,
  isGapLine,
  isTextLine,
  parseHtmlToLines,
  slugifyTitle,
} from "../lib/creative";

test("slugifyTitle formats English titles properly", () => {
  assert.equal(
    slugifyTitle("THE FIRST LESSON IS: NO ONE’S EVEN LOOKING"),
    "the-first-lesson-is-no-ones-even-looking"
  );
  assert.equal(slugifyTitle("WRONG PROBLEM = WRONG SOLUTION"), "wrong-problem-wrong-solution");
  assert.equal(slugifyTitle("WHAT AI CAN’T THINK OF"), "what-ai-cant-think-of");
});

test("decodeHtmlEntities decodes common HTML entities", () => {
  assert.equal(decodeHtmlEntities("It&#039;s a test"), "It’s a test");
  assert.equal(decodeHtmlEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(decodeHtmlEntities("&ldquo;Hello&rdquo;"), "“Hello”");
  assert.equal(decodeHtmlEntities("Wait&hellip;"), "Wait…");
});

test("parseHtmlToLines converts WordPress HTML paragraphs to ArticleLine array", () => {
  const html = `
    <p>Many years ago, my dad joined the police.</p>
    <p>&nbsp;</p>
    <p>As soon as he left the sergeant said, <strong>“Right, the test starts now.”</strong></p>
    <p>The post TEST POST first appeared on Dave Trott's Blog.</p>
  `;
  const lines = parseHtmlToLines(html);

  assert.equal(lines.length, 3);
  assert.equal(isTextLine(lines[0]), true);
  if (isTextLine(lines[0])) {
    assert.equal(lines[0].t, "Many years ago, my dad joined the police.");
  }

  assert.equal(isGapLine(lines[1]), true);

  assert.equal(isTextLine(lines[2]), true);
  if (isTextLine(lines[2])) {
    assert.equal(
      lines[2].t,
      "As soon as he left the sergeant said, **“Right, the test starts now.”**"
    );
  }
});

test("countWords and estimateReadingMinutes work accurately", () => {
  const lines = [
    { t: "One two three four five." },
    { gap: true as const },
    { t: "Six seven eight nine ten." },
  ];
  assert.equal(countWords(lines), 10);
  assert.equal(estimateReadingMinutes(10), 1);
  assert.equal(estimateReadingMinutes(450), 3);
});

test("getWeekdaySchedule returns only weekdays (Monday - Friday)", () => {
  // Bắt đầu từ thứ Sáu ngày 2026-10-30
  const startFriday = new Date(Date.UTC(2026, 9, 30, 0, 0, 0));
  const schedule = getWeekdaySchedule(startFriday, 5);

  assert.equal(schedule.length, 5);
  for (const date of schedule) {
    const day = date.getDay();
    assert.notEqual(day, 0, "Không được rơi vào Chủ Nhật");
    assert.notEqual(day, 6, "Không được rơi vào Thứ Bảy");
  }
});

