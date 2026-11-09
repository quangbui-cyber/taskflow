import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CRM_NOTIFICATION_TYPES, isCrmNotificationType } from "../lib/crm/notificationDisplay";
import { notificationDestination } from "../lib/pushPolicy";
import { dueMessage, overdueMessage, staleDraftMessage, missingNextStepMessage } from "../lib/crm/reminderJobRules";

test("all known and future CRM types use the CRM display rule", () => {
  for (const type of CRM_NOTIFICATION_TYPES) assert.equal(isCrmNotificationType(type), true);
  assert.ok(CRM_NOTIFICATION_TYPES.includes("CRM_NUDGE"));
  assert.equal(isCrmNotificationType("CRM_FUTURE_TYPE"), true);
  for (const type of ["TASK_ASSIGNED", "MEETING_RECAP_READY", "LEAVE_REQUEST"]) assert.equal(isCrmNotificationType(type), false);
  const source = readFileSync(new URL("../lib/notify.ts", import.meta.url), "utf8");
  assert.deepEqual([...new Set(source.match(/CRM_[A-Z_]+/g))].sort(), [...CRM_NOTIFICATION_TYPES].sort());
});
test("CRM destinations preserve client, opportunity and task links", () => {
  for (const type of [...CRM_NOTIFICATION_TYPES, "CRM_FUTURE_TYPE"]) {
    assert.equal(notificationDestination({ type, clientId: "c1" }), "/crm/clients/c1");
    assert.equal(notificationDestination({ type, clientId: "c1", taskId: "t1" }), "/crm/clients/c1?task=t1");
    assert.equal(notificationDestination({ type, opportunityId: "o1", taskId: "t1" }), "/crm/opportunities/o1?task=t1");
  }
});
test("due and overdue copy matches UI-SPEC, nudge copy is short and punctuated", () => {
  assert.equal(dueMessage("Bình Minh Bank", "Nhắc định kỳ"), "Đến hạn tiếp cận Bình Minh Bank: Nhắc định kỳ.");
  assert.equal(overdueMessage("Bình Minh Bank", 7), "Bình Minh Bank quá hạn tiếp cận 7 ngày.");
  for (const message of [staleDraftMessage("Bình Minh Bank", 2), missingNextStepMessage("Bình Minh Bank")]) {
    assert.ok(message.endsWith(".")); assert.doesNotMatch(message, /[—–]/);
  }
});
