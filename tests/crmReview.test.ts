import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReviewGroups, classifyReviewItem, sortReviewGroup, type ReviewItem } from "../lib/crm/review";
import { crmWeekRange } from "../lib/crm/dates";
const now = new Date("2026-11-11T02:00:00Z");
const item = (key: string, extra: Partial<ReviewItem> = {}): ReviewItem => ({ key, clientId: key, tier: "B", dueDate: null, hasOpenNextStep: true, appointment: false, planClose: false, escalated: false, ...extra });
test("review classifies overdue, Sunday due and missing next step once", () => {
  const rows = [item("late", { dueDate: new Date("2026-11-10T05:00:00Z") }), item("sunday", { dueDate: new Date("2026-11-15T16:59:00Z") }), item("none", { hasOpenNextStep: false })];
  const groups = buildReviewGroups(rows, ["APPOINTMENT", "PLAN_CLOSE", "ESCALATED", "TIER"], now);
  assert.deepEqual(groups.OVERDUE.map(({ key }) => key), ["late"]);
  assert.deepEqual(groups.DUE_THIS_WEEK.map(({ key }) => key), ["sunday"]);
  assert.deepEqual(groups.NO_NEXT_STEP.map(({ key }) => key), ["none"]);
  assert.equal(classifyReviewItem(item("future", { dueDate: new Date("2026-11-17") }), crmWeekRange(now), now), null);
});
test("configured priority precedes tier, then due and stable key", () => {
  const rows = [item("C", { tier: "C" }), item("B"), item("UNRATED", { tier: "UNRATED" }), item("A", { tier: "A" }), item("S", { tier: "S" }), item("urgent", { tier: "C", escalated: true })];
  assert.deepEqual(sortReviewGroup(rows, ["ESCALATED", "TIER", "APPOINTMENT", "PLAN_CLOSE"]).map(({ key }) => key), ["urgent", "S", "A", "UNRATED", "B", "C"]);
  assert.equal(rows[0].key, "C", "sort does not mutate input");
});
