import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMeetUrl, normalizeMeetCode, parseMeetCode } from "../lib/meetLink";

test("normalizeMeetCode formats 10 characters into 3-4-3", () => {
  assert.equal(normalizeMeetCode("abcdefghij"), "abc-defg-hij");
  assert.equal(normalizeMeetCode("ABC-DEFG-HIJ"), "abc-defg-hij");
  assert.equal(normalizeMeetCode("abc"), null);
  assert.equal(normalizeMeetCode("abcdefghijk"), null);
});

test("parseMeetCode extracts code from various Google Meet links", () => {
  assert.equal(parseMeetCode("https://meet.google.com/abc-defg-hij"), "abc-defg-hij");
  assert.equal(parseMeetCode("http://meet.google.com/abc-defg-hij"), "abc-defg-hij");
  assert.equal(parseMeetCode("meet.google.com/abc-defg-hij"), "abc-defg-hij");
  assert.equal(parseMeetCode("https://meet.google.com/abc-defg-hij?authuser=1&hs=122"), "abc-defg-hij");
  assert.equal(parseMeetCode("https://meet.google.com/lookup/abcdefghij"), "abc-defg-hij");
  assert.equal(parseMeetCode("https://meet.google.com/ABC-DEFG-HIJ"), "abc-defg-hij");
});

test("parseMeetCode extracts code from invitation text", () => {
  assert.equal(
    parseMeetCode("Để tham gia cuộc họp, hãy bấm: https://meet.google.com/qwe-rtyu-iop nhé!"),
    "qwe-rtyu-iop"
  );
  assert.equal(
    parseMeetCode("Mã cuộc họp của bạn là zxc-vbnm-lkj."),
    "zxc-vbnm-lkj"
  );
});

test("parseMeetCode handles standalone codes", () => {
  assert.equal(parseMeetCode("abc-defg-hij"), "abc-defg-hij");
  assert.equal(parseMeetCode("ABC-DEFG-HIJ"), "abc-defg-hij");
  assert.equal(parseMeetCode("abcdefghij"), "abc-defg-hij");
});

test("parseMeetCode rejects invalid or non-meet links", () => {
  assert.equal(parseMeetCode("https://zoom.us/j/1234567890"), null);
  assert.equal(parseMeetCode("https://teams.microsoft.com/l/meetup-join/19..."), null);
  assert.equal(parseMeetCode("https://example.com/abc-defg-hij"), "abc-defg-hij"); // contains standalone code
  assert.equal(parseMeetCode(""), null);
  assert.equal(parseMeetCode("   "), null);
  assert.equal(parseMeetCode(null), null);
  assert.equal(parseMeetCode("meet.google.com/short"), null);
});

test("formatMeetUrl returns standard Google Meet URL", () => {
  assert.equal(formatMeetUrl("abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  assert.equal(formatMeetUrl("abcdefghij"), "https://meet.google.com/abc-defg-hij");
});
