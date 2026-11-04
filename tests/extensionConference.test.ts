import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

function loadConference() {
  const sent: { type: string }[] = [];
  const headings: { textContent: string; getClientRects: () => number[] }[] = [];
  let tick = () => {};
  const sandbox = {
    document: { querySelectorAll: () => headings },
    chrome: { runtime: { id: "test", sendMessage: async (message: { type: string }) => { sent.push(message); } } },
    setInterval: (fn: () => void) => { tick = fn; },
  };
  vm.runInNewContext(readFileSync(path.join(process.cwd(), "extension/content-conference.js"), "utf8"), {
    ...sandbox, window: {},
  });
  return { sent, headings, tick: () => tick() };
}

test("Teams/Zoom end screen sends one leave event and cancels it when rejoining", () => {
  for (const text of ["You've left the meeting", "You have left the meeting", "The host has ended this meeting", "Bạn đã rời khỏi cuộc họp", "Cuộc họp đã kết thúc"]) {
    const page = loadConference();
    page.headings.push({ textContent: text, getClientRects: () => [1] });
    page.tick();
    page.tick();
    assert.deepEqual(page.sent.map((m) => m.type), ["MEET_LEFT"], text);
    page.headings.length = 0;
    page.tick();
    assert.deepEqual(page.sent.map((m) => m.type), ["MEET_LEFT", "MEET_JOINED"], text);
  }
});

test("waiting rooms, hidden end screens and unrelated headings keep recording", () => {
  const page = loadConference();
  page.headings.push({ textContent: "Waiting for the host to start this meeting", getClientRects: () => [1] });
  page.headings.push({ textContent: "The meeting has ended", getClientRects: () => [] });
  page.headings.push({ textContent: "Discuss what happens when the meeting has ended", getClientRects: () => [1] });
  page.tick();
  assert.deepEqual(page.sent, []);
});
