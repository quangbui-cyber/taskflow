import assert from "node:assert/strict";
import { test } from "node:test";
import { draftsOpenFrom, rowActionsFor, lateLabel, REVIEW_DONE_LABELS, reviewFilterChips, reviewFilterVisibility, nextReviewFilter, reviewRowSentence, reviewPrimaryLabel, reviewLanes, reviewWeekProgress } from "../lib/crm/reviewView";
import type { ReviewRow } from "../lib/crm/reviewData";
import { REVIEW_REASON_LABELS } from "../lib/crm/labels";

const all = { logResult: true, assign: true, postpone: true, escalate: true, assignPic: true };
const row = (overrides: Partial<Pick<ReviewRow, "pic" | "taskId" | "can" | "reason">> = {}) => ({
  pic: { accountId: "a", name: "PIC", userId: "u" }, taskId: "k1", can: all, ...overrides,
});
test("drafts opens only from a single open value", () => {
  const cases: [Record<string, string | string[] | undefined>, boolean][] = [[{}, false], [{ drafts: "open" }, true], [{ drafts: ["open", "open"] }, false], [{ drafts: "x" }, false]];
  for (const [params, expected] of cases) {
    assert.equal(draftsOpenFrom(params), expected);
  }
});
test("overdue actions: assign and postpone shown directly, escalation in the menu", () => {
  assert.deepEqual(rowActionsFor("OVERDUE", row({ can: { ...all, assignPic: false } })), { primary: "LOG_RESULT", secondary: ["ASSIGN", "POSTPONE"], menu: ["ESCALATE"] });
});
test("due this week has no assignment without permission", () => {
  assert.deepEqual(rowActionsFor("DUE_THIS_WEEK", row({ can: { ...all, assign: false } })), { primary: "LOG_RESULT", secondary: ["POSTPONE"], menu: ["ESCALATE"] });
});
test("no next step without task has only set-next-step", () => {
  assert.deepEqual(rowActionsFor("NO_NEXT_STEP", row({ taskId: null })), { primary: "SET_NEXT_STEP", secondary: [], menu: [] });
});
test("no next step with WAIT task permits postponing and escalation", () => {
  assert.deepEqual(rowActionsFor("NO_NEXT_STEP", row()), { primary: "SET_NEXT_STEP", secondary: ["POSTPONE"], menu: ["ESCALATE"] });
});
test("already escalated task does not offer escalation again", () => {
  const reason = { key: "ESCALATED" as const, label: REVIEW_REASON_LABELS.ESCALATED, sourceLabel: null, sentence: "x", lateDays: null };
  assert.deepEqual(rowActionsFor("OVERDUE", row({ reason })), { primary: "LOG_RESULT", secondary: ["ASSIGN", "POSTPONE"], menu: [] });
});
test("missing PIC offers only authorized PIC assignment", () => {
  for (const group of ["OVERDUE", "DUE_THIS_WEEK", "NO_NEXT_STEP"] as const) {
    assert.deepEqual(rowActionsFor(group, row({ pic: null })), { primary: "ASSIGN_PIC", secondary: [], menu: [] });
    assert.deepEqual(rowActionsFor(group, row({ pic: null, can: { ...all, assignPic: false } })), { primary: null, secondary: [], menu: [] });
  }
});
test("view-only rows offer no actions", () => {
  const can = { logResult: false, assign: false, postpone: false, escalate: false, assignPic: false };
  for (const group of ["OVERDUE", "DUE_THIS_WEEK", "NO_NEXT_STEP"] as const) assert.deepEqual(rowActionsFor(group, row({ can })), { primary: null, secondary: [], menu: [] });
});
test("primary labels follow the situation", () => {
  assert.equal(reviewPrimaryLabel("LOG_RESULT"), "Ghi kết quả");
  assert.equal(reviewPrimaryLabel("SET_NEXT_STEP"), "Đặt việc tiếp theo");
  assert.equal(reviewPrimaryLabel("ASSIGN_PIC"), "Giao PIC");
  assert.equal(reviewPrimaryLabel(null), null);
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
test("filter chips have stable order, wording and only overdue warning", () => {
  assert.deepEqual(reviewFilterChips({ overdue: 2, dueThisWeek: 5, noNextStep: 3, drafts: 1, unrated: 4 }), [
    { key: "OVERDUE", label: "Quá hạn", count: 2, warning: true },
    { key: "DUE_THIS_WEEK", label: "Trong tuần", count: 5, warning: false },
    { key: "NO_NEXT_STEP", label: "Chưa có việc tiếp theo", count: 3, warning: false },
    { key: "UNRATED", label: "Chưa xếp hạng", count: 4, warning: false },
    { key: "DRAFTS", label: "Nháp chờ xác nhận", count: 1, warning: false },
  ]);
  assert.equal(reviewFilterChips({ overdue: 0, dueThisWeek: 1, noNextStep: 0, drafts: 2, unrated: 0 })[0].warning, false);
});
test("filters show one group and toggle back to all", () => {
  assert.deepEqual(reviewFilterVisibility(null), { groups: ["OVERDUE", "DUE_THIS_WEEK", "NO_NEXT_STEP"], unrated: true, drafts: true });
  for (const key of ["OVERDUE", "DUE_THIS_WEEK", "NO_NEXT_STEP"] as const) assert.deepEqual(reviewFilterVisibility(key), { groups: [key], unrated: false, drafts: false });
  assert.deepEqual(reviewFilterVisibility("UNRATED"), { groups: [], unrated: true, drafts: false });
  assert.deepEqual(reviewFilterVisibility("DRAFTS"), { groups: [], unrated: false, drafts: true });
  assert.equal(nextReviewFilter(null, "OVERDUE"), "OVERDUE");
  assert.equal(nextReviewFilter("OVERDUE", "OVERDUE"), null);
  assert.equal(nextReviewFilter("OVERDUE", "DRAFTS"), "DRAFTS");
});

const cadence = { S: 2, A: 4, B: 8, C: 12, UNRATED: 6 };
const now = new Date("2026-11-10T09:00:00+07:00");
type SentenceRow = Parameters<typeof reviewRowSentence>[0];
const base: SentenceRow = {
  group: "OVERDUE", taskId: "t1", dueDate: new Date("2026-11-08T10:00:00+07:00"),
  client: { id: "c", name: "Hòa Phát", version: 1, tier: "B", buyingUnitName: null },
  reason: { key: "EVENT_REMINDER", label: REVIEW_REASON_LABELS.EVENT_REMINDER, sourceLabel: "Khách xác nhận", sentence: "Gọi hỏi lịch MICE 2027", lateDays: 2 },
  lastTouch: { date: new Date("2026-11-03T10:00:00+07:00"), kindLabel: "Gọi", outcomeLabel: "Có phản hồi thực chất" },
};
test("overdue row reads as a sentence with reason source and last touch", () => {
  assert.deepEqual(reviewRowSentence(base, now, cadence), {
    todo: "Gọi hỏi lịch MICE 2027", todoMuted: false, lateLabel: "Trễ 2 ngày", lateTone: "late",
    why: "Mốc trước sự kiện (khách xác nhận)", lastTouch: "Lần trước 03/11: gọi, có phản hồi thực chất",
  });
});
test("due this week row shows its due date, not a late label", () => {
  const result = reviewRowSentence({ ...base, group: "DUE_THIS_WEEK", dueDate: new Date("2026-11-13T10:00:00+07:00"), reason: { ...base.reason, key: "NEXT_STEP", label: REVIEW_REASON_LABELS.NEXT_STEP, sourceLabel: null } }, now, cadence);
  assert.equal(result.lateLabel, "Hạn 13/11"); assert.equal(result.lateTone, null);
  assert.equal(result.why, "Việc tiếp theo đã hẹn");
});
test("due today row says today", () => {
  const result = reviewRowSentence({ ...base, group: "DUE_THIS_WEEK", dueDate: new Date("2026-11-10T23:30:00+07:00") }, now, cadence);
  assert.equal(result.lateLabel, "Hạn hôm nay");
});
test("no next step row drops the next-step chip and counts weeks against tier cadence", () => {
  const noNext: SentenceRow = { ...base, group: "NO_NEXT_STEP", taskId: null, dueDate: null, client: { ...base.client, tier: "S" },
    reason: { key: "NEXT_STEP", label: REVIEW_REASON_LABELS.NEXT_STEP, sourceLabel: null, sentence: "Chưa có bước tiếp theo", lateDays: null },
    lastTouch: { date: new Date("2026-10-01T10:00:00+07:00"), kindLabel: "Gửi quà", outcomeLabel: null } };
  const result = reviewRowSentence(noNext, now, cadence);
  assert.deepEqual(result, { todo: "Chưa có việc tiếp theo", todoMuted: true, lateLabel: "Đã 5 tuần chưa liên hệ", lateTone: "warn", why: "Chu kỳ hạng S: 2 tuần", lastTouch: "Lần trước 01/10: gửi quà" });
  assert.ok(!JSON.stringify(result).includes("Bước tiếp theo"));
  const recent = reviewRowSentence({ ...noNext, client: { ...noNext.client, tier: "A" }, lastTouch: { ...noNext.lastTouch!, date: new Date("2026-10-28T10:00:00+07:00") } }, now, cadence);
  assert.equal(recent.lateLabel, null); assert.equal(recent.why, "Chu kỳ hạng A: 4 tuần");
});
test("no next step for plan close keeps that reason before the cadence", () => {
  const result = reviewRowSentence({ ...base, group: "NO_NEXT_STEP", taskId: null, dueDate: null, reason: { key: "PLAN_CLOSE", label: REVIEW_REASON_LABELS.PLAN_CLOSE, sourceLabel: null, sentence: "x", lateDays: null } }, now, cadence);
  assert.equal(result.why, "Kỳ chốt kế hoạch · Chu kỳ hạng B: 8 tuần");
});
test("unrated client without touchpoint has no dash and a readable cadence", () => {
  const result = reviewRowSentence({ ...base, group: "NO_NEXT_STEP", taskId: null, dueDate: null, client: { ...base.client, tier: "UNRATED" }, reason: { key: "NEXT_STEP", label: REVIEW_REASON_LABELS.NEXT_STEP, sourceLabel: null, sentence: "x", lateDays: null }, lastTouch: null }, now, cadence);
  assert.equal(result.lastTouch, null);
  assert.equal(result.lateLabel, "Chưa có liên hệ đã xác nhận");
  assert.equal(result.why, "Chu kỳ khách chưa xếp hạng: 6 tuần");
  assert.ok(!Object.values(result).includes("—"));
});
test("weeks since last touch use Vietnam days across midnight", () => {
  const noNext: SentenceRow = { ...base, group: "NO_NEXT_STEP", taskId: null, dueDate: null, client: { ...base.client, tier: "S" }, lastTouch: { date: new Date("2026-10-27T23:30:00+07:00"), kindLabel: "Gọi", outcomeLabel: null } };
  assert.equal(reviewRowSentence(noNext, new Date("2026-11-09T23:59:00+07:00"), cadence).lateLabel, null);
  assert.equal(reviewRowSentence(noNext, new Date("2026-11-10T00:01:00+07:00"), cadence).lateLabel, "Đã 2 tuần chưa liên hệ");
});
test("labels use Việc tiếp theo wording", () => {
  assert.equal(REVIEW_REASON_LABELS.NEXT_STEP, "Việc tiếp theo");
  assert.equal(REVIEW_REASON_LABELS.ESCALATED, "Đã nhờ AD/AM");
});

// ---- crm51: two lanes and the week progress bar ----
type LaneRow = { key: string; dueDate: Date | null };
const lane = (key: string, dueDate: Date | null): LaneRow => ({ key, dueDate });
test("lanes: overdue and due today first, later this week second, order kept", () => {
  const monday = new Date("2026-11-09T09:00:00+07:00");
  const groups = {
    OVERDUE: [lane("late-2", new Date("2026-11-07T10:00:00+07:00")), lane("late-1", new Date("2026-11-08T23:50:00+07:00"))],
    DUE_THIS_WEEK: [lane("fri", new Date("2026-11-13T10:00:00+07:00")), lane("today-night", new Date("2026-11-09T23:59:00+07:00")), lane("today", new Date("2026-11-09T00:00:00+07:00"))],
    NO_NEXT_STEP: [lane("none", null)],
  };
  const lanes = reviewLanes(groups, monday);
  assert.deepEqual(lanes.first.map(r => r.key), ["late-2", "late-1", "today-night", "today"]);
  assert.deepEqual(lanes.week.map(r => r.key), ["fri"]);
});
test("lanes use the Vietnam day even when the server clock is UTC", () => {
  // 17:30Z on the 9th is already 00:30 on the 10th in Ho Chi Minh City.
  const now = new Date("2026-11-09T17:30:00Z");
  const lanes = reviewLanes({ OVERDUE: [], DUE_THIS_WEEK: [lane("tenth", new Date("2026-11-10T08:00:00+07:00")), lane("eleventh", new Date("2026-11-11T08:00:00+07:00"))], NO_NEXT_STEP: [] }, now);
  assert.deepEqual(lanes.first.map(r => r.key), ["tenth"]);
  assert.deepEqual(lanes.week.map(r => r.key), ["eleventh"]);
});
test("week progress counts late, today, rest and done with percentages that sum to 100", () => {
  const now = new Date("2026-11-11T10:00:00+07:00");
  const groups = {
    OVERDUE: [lane("a", new Date("2026-11-01T10:00:00+07:00")), lane("b", new Date("2026-11-10T10:00:00+07:00"))],
    DUE_THIS_WEEK: [lane("c", new Date("2026-11-11T18:00:00+07:00")), lane("d", new Date("2026-11-12T10:00:00+07:00")), lane("e", new Date("2026-11-15T10:00:00+07:00"))],
    NO_NEXT_STEP: [lane("f", null)],
  };
  const progress = reviewWeekProgress(groups, 3, now);
  assert.deepEqual(progress.counts, { late: 2, today: 1, rest: 2, done: 3 });
  assert.equal(progress.total, 8);
  assert.equal(progress.label, "3/8");
  const sumPercent = progress.segments.reduce((s, x) => s + x.percent, 0);
  assert.ok(Math.abs(sumPercent - 100) < 1e-9);
  assert.deepEqual(progress.segments.map(s => s.key), ["late", "today", "rest", "done"]);
});
test("empty week progress has no segments and does not divide by zero", () => {
  const progress = reviewWeekProgress({ OVERDUE: [], DUE_THIS_WEEK: [], NO_NEXT_STEP: [] }, 0, new Date("2026-11-11T10:00:00+07:00"));
  assert.equal(progress.total, 0);
  assert.deepEqual(progress.segments.map(s => s.percent), [0, 0, 0, 0]);
  assert.equal(progress.label, "0/0");
});
