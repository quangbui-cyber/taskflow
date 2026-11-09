import assert from "node:assert/strict";
import { test } from "node:test";
import { overdueDays, shouldNotifyOverdue, planClosePeriod, dueMessage, overdueMessage, reminderTaskTitle, crmDedupeKey, staleDraftMessage, missingNextStepMessage } from "../lib/crm/reminderJobRules";
const vn = (key: string) => new Date(`${key}T00:00:00+07:00`);
test("overdue uses VN calendar days and never returns negative days", () => {
  const now = new Date("2026-11-06T09:00:00+07:00");
  assert.equal(overdueDays(vn("2026-11-05"), now), 1); assert.equal(overdueDays(vn("2026-11-06"), now), 0); assert.equal(overdueDays(vn("2026-11-07"), now), 0);
  assert.equal(overdueDays(new Date("2026-11-05T23:59:00+07:00"), now), 1);
});
test("overdue notice cadence is day 1, 3, 7 and weekly thereafter", () => {
  for (const days of [1, 3, 7, 14, 21, 28]) assert.equal(shouldNotifyOverdue(days), true);
  for (const days of [-1, 0, 2, 8, 15, 1.5, NaN]) assert.equal(shouldNotifyOverdue(days), false);
});
test("plan-close lead window is 28 days and period keys follow the target year", () => {
  const p = planClosePeriod(12, vn("2026-11-10")); assert.equal(p?.periodKey, "plan-close:2026"); assert.equal(p?.dueDate.toISOString(), "2026-11-30T17:00:00.000Z");
  assert.equal(planClosePeriod(3, vn("2026-11-10")), null); assert.equal(planClosePeriod(null, vn("2026-11-10")), null);
  assert.equal(planClosePeriod(1, vn("2026-12-20"))?.periodKey, "plan-close:2027");
  assert.equal(planClosePeriod(12, vn("2026-11-03"))?.periodKey, "plan-close:2026"); assert.equal(planClosePeriod(12, vn("2026-11-02")), null);
  assert.equal(planClosePeriod(12, vn("2026-12-01"))?.periodKey, "plan-close:2026");
  for (const month of [0, 13, 1.5]) assert.equal(planClosePeriod(month, vn("2026-11-10")), null);
});
test("due copy matches the UI contract", () => assert.equal(dueMessage("ACME", "Nhắc định kỳ"), "Đến hạn tiếp cận ACME: Nhắc định kỳ."));
test("overdue copy matches the UI contract", () => assert.equal(overdueMessage("ACME", 3), "ACME quá hạn tiếp cận 3 ngày."));
test("task titles and weekly nudges keep approved/planner copy", () => {
  assert.equal(reminderTaskTitle("VERIFY_MONTH", { clientName: "ACME", programLabel: "MICE" }), "Xác minh tháng MICE với ACME");
  assert.equal(reminderTaskTitle("OFFSET", { clientName: "ACME", programLabel: "MICE", offsetDays: 60 }), "Tiếp cận ACME: MICE còn 60 ngày");
  assert.equal(reminderTaskTitle("CADENCE", { clientName: "ACME" }), "Nhắc định kỳ: ACME");
  assert.equal(reminderTaskTitle("PLAN_CLOSE", { clientName: "ACME" }), "Kỳ chốt kế hoạch: ACME");
  assert.equal(staleDraftMessage("ACME", 2), "Có 2 điểm chạm nháp của ACME chờ xác nhận quá 7 ngày.");
  assert.equal(missingNextStepMessage("ACME"), "ACME có Cơ hội đang mở nhưng chưa có bước tiếp theo.");
});
test("CRM dedupe keys hold task/day/user or nudge/week identity", () => assert.equal(crmDedupeKey(["t1", "2026-11-06", "u1"]), "crm:t1:2026-11-06:u1"));
