import assert from "node:assert/strict";
import test from "node:test";
import { validTaskTimeRange } from "../lib/taskTimeRange";

test("task start is optional for legacy and deadline-only tasks", () => {
  assert.equal(validTaskTimeRange(null, null), true);
  assert.equal(validTaskTimeRange(null, new Date("2026-10-30T10:00:00Z")), true);
});

test("task end must be later than start on the same Vietnam calendar day", () => {
  const start = new Date("2026-10-30T09:00:00Z"); // 16:00 VN
  assert.equal(
    validTaskTimeRange(start, new Date("2026-10-30T10:00:00Z")),
    true
  );
  assert.equal(validTaskTimeRange(start, new Date("2026-10-30T09:00:00Z")), false);
  assert.equal(validTaskTimeRange(start, new Date("2026-10-30T08:30:00Z")), false);
  assert.equal(validTaskTimeRange(start, null), false);
});

test("task range cannot cross midnight in Vietnam", () => {
  const start = new Date("2026-10-30T16:30:00Z"); // 23:30 VN
  const end = new Date("2026-10-30T17:00:00Z"); // 00:00 VN next day
  assert.equal(validTaskTimeRange(start, end), false);
});
