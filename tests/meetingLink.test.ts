import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMeetingLink } from "../extension/meeting-link.js";

const key = (url: string) => parseMeetingLink(url)?.key;

test("Google Meet keeps its existing identity across URL forms", () => {
  assert.equal(key("https://meet.google.com/abc-defg-hij?authuser=1"), "google:abc-defg-hij");
  assert.equal(key("https://meet.google.com/lookup/abcdefghij"), "google:abc-defg-hij");
});

test("Zoom invite and browser meeting URLs match across subdomains, excluding passcodes", () => {
  for (const url of [
    "https://us02web.zoom.us/j/12345678901?pwd=abc",
    "https://zoom.us/s/12345678901",
    "https://app.zoom.us/wc/12345678901/join?pwd=def",
    "https://zoom.us/wc/join/12345678901",
    "https://app.zoom.com/wc/12345678901/start",
  ]) assert.equal(key(url), "zoom:12345678901");
  assert.notEqual(key("https://zoom.us/j/12345678901"), key("https://zoom.us/j/12345678902"));
});

test("Teams classic links, encoded room IDs, browser hash routes and new short links", () => {
  const classic = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_Test%40thread.v2/0?context=abc";
  const browser = "https://teams.cloud.microsoft/v2/#/meet/19%3ameeting_Test%40thread.v2?anon=true";
  assert.equal(key(classic), "teams:work:19:meeting_Test@thread.v2");
  assert.equal(key(browser), key(classic));
  assert.equal(key("https://teams.microsoft.com/meet/123456789012?p=abc"), "teams:work:123456789012");
  assert.equal(key("https://teams.live.com/meet/123456789012?p=def"), "teams:personal:123456789012");
  assert.notEqual(key("https://teams.live.com/meet/123456789012"), key("https://teams.microsoft.com/meet/123456789012"));
});

test("rejects lookalike hosts, non-meeting pages and malformed URLs", () => {
  for (const url of [
    "https://zoom.us.evil.test/j/12345678901", "https://evilzoom.us/j/12345678901",
    "https://teams.microsoft.com.evil.test/meet/123456789012", "https://meet.google.com.evil.test/abc-defg-hij",
    "https://zoom.us/profile", "https://teams.microsoft.com/v2/", "https://meet.google.com/landing",
    "https://zoom.us/j/123", "http://zoom.us/j/12345678901", "https://zoom.us@evil.test/j/12345678901",
    "https://teams.microsoft.com/meet/%invalid", "https://example.com/abc-defg-hij", "not a url",
  ]) assert.equal(parseMeetingLink(url), null, url);
});
