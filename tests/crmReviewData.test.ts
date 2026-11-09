import assert from "node:assert/strict";
import test from "node:test";
import { resolveReviewFilters, clientInCare, reviewReasonFor, toReviewItem, reviewPrefill } from "../lib/crm/reviewData";
import { DEFAULT_CADENCE_WEEKS } from "../lib/crm/settingsSchema";

const ctx = { managedTeamIds: ["t2"], accountTeamId: "t1", accountId: "a1", teamIds: ["t1", "t2"] };
test("review defaults to Account team then first known managed team then all", () => {
  assert.deepEqual(resolveReviewFilters({}, ctx), { teamId: "t1", pic: "all", key: "t1|all" });
  assert.equal(resolveReviewFilters({ team: "unknown" }, ctx).teamId, "t1");
  assert.equal(resolveReviewFilters({}, { ...ctx, accountTeamId: null }).teamId, "t2");
  assert.equal(resolveReviewFilters({}, { ...ctx, accountTeamId: null, managedTeamIds: [] }).teamId, null);
  assert.equal(resolveReviewFilters({}, { ...ctx, accountTeamId: "gone", managedTeamIds: ["gone", "t2"] }).teamId, "t2");
});
test("review validates filters against known ids and ignores arrays or oversized values", () => {
  assert.deepEqual(resolveReviewFilters({ team: "all", pic: "me" }, ctx), { teamId: null, pic: "me", key: "all|me" });
  assert.equal(resolveReviewFilters({ pic: "me" }, { ...ctx, accountId: null }).pic, "all");
  assert.equal(resolveReviewFilters({ pic: "a9" }, { ...ctx, picAccountIds: ["a9"] }).pic, "a9");
  assert.equal(resolveReviewFilters({ pic: "a9" }, ctx).pic, "all");
  for (const team of [["t1", "t2"], "a".repeat(65)]) assert.equal(resolveReviewFilters({ team }, ctx).teamId, "t1");
  for (const pic of [["me"], "a".repeat(65)]) assert.equal(resolveReviewFilters({ pic }, ctx).pic, "all");
});
test("in care is one shared PIC, open Opportunity, active event or import rule", () => {
  const bare = { picAccountId: null, openOpportunityCount: 0, activeEventCount: 0, importStatus: null };
  assert.equal(clientInCare(bare), false);
  for (const extra of [{ picAccountId: "p" }, { openOpportunityCount: 1 }, { activeEventCount: 1 }, { importStatus: "PENDING_PIC_CONFIRM" }]) assert.equal(clientInCare({ ...bare, ...extra }), true);
});
test("review reasons preserve escalation and normalize unknown task kinds", () => {
  assert.equal(reviewReasonFor({ crmKind: "CADENCE", escalatedAt: new Date() }, false), "ESCALATED");
  for (const crmKind of ["APPOINTMENT", "EVENT_REMINDER", "VERIFY_MONTH", "CADENCE", "WAIT", "NEXT_STEP"] as const) assert.equal(reviewReasonFor({ crmKind, escalatedAt: null }, true), crmKind);
  for (const crmKind of ["WINBACK", "BID_PREP", null]) assert.equal(reviewReasonFor({ crmKind, escalatedAt: null }, true), "NEXT_STEP");
  assert.equal(reviewReasonFor(null, true), "PLAN_CLOSE"); assert.equal(reviewReasonFor(null, false), "NEXT_STEP");
});
test("review items use Vietnam months, including December rollover", () => {
  const now = new Date("2026-11-30T18:00:00Z"); // 01/12 VN
  const base = { clientId: "c1", tier: "A" as const, task: null, budgetSeasonMonth: 12 };
  assert.deepEqual(toReviewItem(base, now), { key: "client:c1", clientId: "c1", tier: "A", dueDate: null, hasOpenNextStep: false, appointment: false, planClose: true, escalated: false });
  assert.equal(toReviewItem({ ...base, budgetSeasonMonth: 1 }, now).planClose, true);
  assert.equal(toReviewItem({ ...base, budgetSeasonMonth: 3 }, now).planClose, false);
  const task = { id: "task", dueDate: now, crmKind: "APPOINTMENT", escalatedAt: now };
  const item = toReviewItem({ ...base, task }, now); assert.equal(item.key, "task"); assert.equal(item.appointment, true); assert.equal(item.escalated, true); assert.equal(item.hasOpenNextStep, true);
});
test("touchpoint prefill uses the tier cadence and assignee then PIC", () => {
  const input = { clientId: "c1", opportunityId: "o1", taskId: "k1", taskAssigneeId: "u2", picUserId: "u1", tier: "A" as const, cadenceWeeks: DEFAULT_CADENCE_WEEKS };
  const now = new Date("2026-11-11T03:00:00Z");
  assert.deepEqual(reviewPrefill(input, now), { clientId: "c1", opportunityId: "o1", completeTaskId: "k1", title: null, nextDueDate: "2026-12-09", assigneeId: "u2" });
  assert.equal(reviewPrefill({ ...input, taskId: null, taskAssigneeId: null }, now).assigneeId, "u1");
  assert.equal(reviewPrefill({ ...input, taskAssigneeId: null, picUserId: null }, now).assigneeId, null);
  assert.equal(reviewPrefill({ ...input, tier: "S" }, new Date("2026-12-31T18:00:00Z")).nextDueDate, "2027-01-15");
});
