import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTouchpointPayload, emptyTouchpointForm, TOUCHPOINT_FIELD_ORDER, validateTouchpointForm } from "../lib/crm/touchpointForm";

const valid = () => ({ ...emptyTouchpointForm({ clientId: "c1", title: "Gọi lại", nextDueDate: "2026-12-09", assigneeId: "u2" }, "2026-11-11"), outcomeLevel: 2 });
test("prefills preserve task/draft context and nullable values without guessing dates", () => {
  const s = valid(); assert.equal(s.mode, "NEXT_STEP"); assert.equal(s.nextTitle, "Gọi lại"); assert.equal(s.nextDueDate, "2026-12-09"); assert.equal(s.assigneeId, "u2"); assert.equal(s.occurredAt, "2026-11-11");
  const empty = emptyTouchpointForm({ nextDueDate: null, assigneeId: null, title: null }, "2026-11-11");
  assert.equal(empty.nextDueDate, ""); assert.equal(empty.assigneeId, null); assert.equal(empty.nextTitle, "");
  const draft = emptyTouchpointForm({ clientId: "c1", opportunityId: "o1", completeTaskId: "t1", confirmDraftId: "d1", kind: "MEETING", occurredAt: "2026-11-10T18:00:00Z" }, "2026-11-11");
  assert.equal(draft.occurredAt, "2026-11-11"); assert.equal(draft.completeTaskId, "t1"); assert.equal(draft.confirmDraftId, "d1");
});
test("outcome is required with exact copy and deterministic focus order", () => {
  assert.equal(validateTouchpointForm({ ...valid(), outcomeLevel: null }).outcomeLevel, "Chọn mức kết quả.");
  assert.ok(TOUCHPOINT_FIELD_ORDER.indexOf("clientId") < TOUCHPOINT_FIELD_ORDER.indexOf("outcomeLevel"));
});
test("next step requires title, active-option assignee and a real VN date", () => {
  for (const change of [{ nextTitle: "" }, { nextDueDate: "" }]) assert.equal(validateTouchpointForm({ ...valid(), ...change }).nextTitle, "Nhập việc cần làm và hạn, hoặc chọn Chờ khách.");
  assert.ok(validateTouchpointForm({ ...valid(), assigneeId: null }).assigneeId);
  assert.ok(validateTouchpointForm({ ...valid(), nextDueDate: "2026-02-30" }).nextDueDate);
});
test("WAIT requires reason and review date", () => {
  assert.equal(validateTouchpointForm({ ...valid(), mode: "WAIT", waitReason: "", waitReviewDate: "" }).waitReason, "Nhập lý do chờ và ngày xem lại.");
  const s = { ...valid(), mode: "WAIT" as const, waitReason: " Đợi khách ", waitReviewDate: "2026-12-10" };
  assert.deepEqual(validateTouchpointForm(s), {}); const p = buildTouchpointPayload(s, "request");
  assert.equal(p.next.mode, "WAIT"); assert.ok("reason" in p.next && p.next.reason === "Đợi khách");
});
test("new CARE needs program, period and demand only at outcome 4 without an Opportunity", () => {
  const s = { ...valid(), outcomeLevel: 4, openOpportunity: true };
  const errors = validateTouchpointForm(s);
  assert.equal(errors.programTypeCode, "Chọn loại chương trình."); assert.equal(errors.expectedPeriod, "Nhập tháng hoặc quý dự kiến."); assert.equal(errors.demandSignal, "Nhập tín hiệu nhu cầu.");
  assert.equal(buildTouchpointPayload({ ...s, outcomeLevel: 3 }, "r").openOpportunity, null);
  assert.equal(buildTouchpointPayload({ ...s, opportunityId: "opp" }, "r").openOpportunity, null);
});
test("GIFT payload exposes precisely the touchpoint allowlist, never gift value", () => {
  const p = buildTouchpointPayload({ ...valid(), kind: "GIFT" }, "request");
  assert.deepEqual(Object.keys(p).sort(), ["clientRequestId", "clientId", "opportunityId", "kind", "occurredAt", "outcomeLevel", "notes", "openOpportunity", "next", "completeTaskId", "confirmDraftId"].sort());
});
test("payload keeps request id, converts VN days and trims notes", () => {
  const p = buildTouchpointPayload(valid(), "same-key");
  assert.equal(p.clientRequestId, "same-key"); assert.equal(p.occurredAt.toISOString(), "2026-11-10T17:00:00.000Z"); assert.equal(p.notes, null);
  assert.equal(buildTouchpointPayload({ ...valid(), notes: "  reply  " }, "r").notes, "reply");
  assert.ok(validateTouchpointForm({ ...valid(), notes: "x".repeat(2001) }).notes);
});
test("valid CARE month/quarter payloads, limits and invalid calendar dates are checked", () => {
  const s = { ...valid(), outcomeLevel: 4, openOpportunity: true, programTypeCode: "MICE", expectedYear: "2027", expectedPeriod: "3", demandSignal: " confirmed " };
  assert.deepEqual(validateTouchpointForm(s), {}); assert.equal(buildTouchpointPayload(s, "r").openOpportunity?.expectedMonth, 3);
  assert.equal(buildTouchpointPayload({ ...s, periodMode: "QUARTER" }, "r").openOpportunity?.expectedQuarter, 3);
  assert.ok(validateTouchpointForm({ ...s, periodMode: "QUARTER", expectedPeriod: "5" }).expectedPeriod);
  assert.ok(validateTouchpointForm({ ...s, occurredAt: "2026-02-30" }).occurredAt);
  assert.ok(validateTouchpointForm({ ...s, demandSignal: "x".repeat(2001) }).demandSignal);
});
