import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: { body: string; data: { url: string } } }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://app.example.test" },
    addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; },
    registration: { showNotification: async (title: string, options: typeof shown[number]["options"]) => { shown.push({ title, options }); } },
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL });
  return { handlers, shown, opened };
}

test("background pushes show the message and clicking opens the correct task", async () => {
  const w = worker();
  let pending: Promise<unknown> = Promise.resolve();
  w.handlers.push({ data: { json: () => ({ title: "myCreative", body: "Giao việc mới", url: "/projects/p1?task=t1" }) }, waitUntil: (value: Promise<unknown>) => { pending = value; } });
  await pending;
  assert.equal(w.shown[0].options.body, "Giao việc mới");
  assert.equal(w.shown[0].options.data.url, "https://app.example.test/projects/p1?task=t1");
  let closed = false;
  w.handlers.notificationclick({ notification: { close: () => { closed = true; }, data: w.shown[0].options.data }, waitUntil: (value: Promise<unknown>) => { pending = value; } });
  await pending;
  assert.ok(closed);
  assert.deepEqual(w.opened, ["https://app.example.test/projects/p1?task=t1"]);
});

test("malformed payloads still show a notification and external destinations fall back safely", async () => {
  for (const payload of [null, "text", { url: "https://evil.test/" }, { url: "//evil.test/" }, { url: "/admin" }]) {
    const w = worker();
    let pending: Promise<unknown> = Promise.resolve();
    w.handlers.push({ data: { json: () => payload }, waitUntil: (value: Promise<unknown>) => { pending = value; } });
    await pending;
    assert.equal(w.shown.length, 1);
    assert.equal(w.shown[0].options.data.url, "https://app.example.test/notifications");
  }
});
