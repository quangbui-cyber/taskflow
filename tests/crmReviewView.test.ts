import assert from "node:assert/strict";
import { test } from "node:test";
import { draftsOpenFrom, rowActionsFor, lateLabel, REVIEW_DONE_LABELS, reviewTiles } from "../lib/crm/reviewView";
import type { ReviewRow } from "../lib/crm/reviewData";

const all = { logResult: true, assign: true, postpone: true, escalate: true, assignPic: true };
const row = (overrides: Partial<Pick<ReviewRow, "pic" | "taskId" | "can">> = {}) => ({
  pic: { accountId: "a", name: "PIC", userId: "u" }, taskId: "k1", can: all, ...overrides,
});
test("drafts opens only from a single open value", () => {
  for (const [params, expected] of [[{}, false], [{ drafts: "open" }, true], [{ drafts: ["open", "open"] }, false], [{ drafts: "x" }, false]] as const) {
    assert.equal(draftsOpenFrom(params), expected);
  }
});
test("overdue actions respect permission flags", () => {
  assert.deepEqual(rowActionsFor("OVERDUE", row({ can: { ...all, assignPic: false } })), { primary: "LOG_RESULT", menu: ["ASSIGN", "POSTPONE", "ESCALATE"] });
});
test("due this week has no assignment without permission", () => {
  assert.deepEqual(rowActionsFor("DUE_THIS_WEEK", row({ can: { ...all, assign: false } })), { primary: "LOG_RESULT", menu: ["POSTPONE", "ESCALATE"] });
});
test("no next step without task has only set-next-step", () => {
  assert.deepEqual(rowActionsFor("NO_NEXT_STEP", row({ taskId: null })), { primary: "SET_NEXT_STEP", menu: [] });
});
test("no next step with WAIT task permits postponing and escalation", () => {
  assert.deepEqual(rowActionsFor("NO_NEXT_STEP", row()), { primary: "SET_NEXT_STEP", menu: ["POSTPONE", "ESCALATE"] });
});
test("missing PIC offers only authorized PIC assignment", () => {
  for (const group of ["OVERDUE", "DUE_THIS_WEEK", "NO_NEXT_STEP"] as const) {
    assert.deepEqual(rowActionsFor(group, row({ pic: null })), { primary: "ASSIGN_PIC", menu: [] });
    assert.deepEqual(rowActionsFor(group, row({ pic: null, can: { ...all, assignPic: false } })), { primary: null, menu: [] });
  }
});
test("view-only rows offer no actions", () => {
  const can = { logResult: false, assign: false, postpone: false, escalate: false, assignPic: false };
  for (const group of ["OVERDUE", "DUE_THIS_WEEK", "NO_NEXT_STEP"] as const) assert.deepEqual(rowActionsFor(group, row({ can })), { primary: null, menu: [] });
});
test("late label uses Vietnam calendar days across midnight", () => {
  const due = new Date("2026-11-05T23:45:00+07:00");
  assert.equal(lateLabel(due, new Date("2026-11-09T23:30:00+07:00")), "Trễ 4 ngày");
  assert.equal(lateLabel(due, new Date("2026-11-10T00:30:00+07:00")), "Trễ 5 ngày");
  assert.equal(lateLabel(due, new Date("2026-11-05T00:30:00+07:00")), null);
  assert.equal(lateLabel(due, new Date("2026-11-04T23:30:00+07:00")), null);
  assert.equal(lateLabel(null, new Date()), null);
});
test("done labels match the review contract", () => assert.deepEqual(REVIEW_DONE_LABELS, { LOGGED: "Đã ghi", ASSIGNED: "Đã giao", POSTPONED: "Đã hoãn" }));
test("tiles have stable order, anchors and only overdue warning", () => {
  assert.deepEqual(reviewTiles({ overdue: 2, dueThisWeek: 5, noNextStep: 3, drafts: 1 }), [
    { label: "Quá hạn", count: 2, anchor: "crm-group-overdue", warning: true },
    { label: "Đến hạn tuần này", count: 5, anchor: "crm-group-due", warning: false },
    { label: "Chưa có bước tiếp theo", count: 3, anchor: "crm-group-no-next", warning: false },
    { label: "Nháp chờ xác nhận", count: 1, anchor: "crm-drafts", warning: false },
  ]);
  assert.equal(reviewTiles({ overdue: 0, dueThisWeek: 1, noNextStep: 0, drafts: 2 })[0].warning, false);
});
