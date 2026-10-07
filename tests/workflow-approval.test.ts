import test from "node:test";
import assert from "node:assert/strict";
import { decide, validateSteps, type ApprovalStep } from "../lib/workflow/approval";
import { assertApprovalToken, correctionItems } from "../lib/workflow/approvalEvents";
import { assertWorkflowLifecycleAllows } from "../lib/workflow/lifecycle";

const chain: ApprovalStep[] = [
  { role: "MANAGER", assigneeId: "same-person" },
  { role: "ACCOUNTANT", assigneeId: "same-person" },
  { role: "CEO", assigneeId: "ceo" },
];

test("approval advances one assigned step even when one actor owns consecutive roles", () => {
  assert.deepEqual(validateSteps(chain), chain);
  const first = decide({ state: "SUBMITTED", currentStep: 0, steps: chain, creatorId: "creator" }, "same-person", "APPROVE", "");
  assert.equal(first.state, "SUBMITTED");
  assert.equal(first.currentStep, 1);
  const second = decide({ state: "SUBMITTED", currentStep: first.currentStep, steps: chain, creatorId: "creator" }, "same-person", "APPROVE", "");
  assert.equal(second.currentStep, 2);
});

test("approval rejects wrong actor and requires return or reject reason", () => {
  assert.throws(() => decide({ state: "SUBMITTED", currentStep: 0, steps: chain, creatorId: "creator" }, "outsider", "APPROVE", ""), /bước hiện tại|quyền/);
  assert.throws(() => decide({ state: "SUBMITTED", currentStep: 0, steps: chain, creatorId: "creator" }, "same-person", "RETURN", ""), /lý do/);
  assert.throws(() => decide({ state: "SUBMITTED", currentStep: 0, steps: chain, creatorId: "creator" }, "same-person", "REJECT", ""), /lý do/);
  assert.equal(decide({ state: "SUBMITTED", currentStep: 2, steps: chain, creatorId: "creator" }, "ceo", "RETURN", "", { reasonOptional: true }).state, "RETURNED");
});

test("creator withdrawal is separate from assigned approval", () => {
  const result = decide({ state: "SUBMITTED", currentStep: 0, steps: chain, creatorId: "creator" }, "creator", "WITHDRAW", "Đổi hồ sơ");
  assert.equal(result.state, "WITHDRAWN");
  assert.throws(() => decide({ state: "SUBMITTED", currentStep: 0, steps: chain, creatorId: "creator" }, "same-person", "WITHDRAW", "Đổi hồ sơ"), /người lập/);
});

test("approval token and structured return bind the current attempt", () => {
  const form = new FormData();
  form.set("module", "WORKFLOW"); form.set("attemptId", "attempt-1"); form.set("stepIndex", "1"); form.set("submittedVersion", "4");
  assert.doesNotThrow(() => assertApprovalToken({ module: "WORKFLOW", currentAttemptId: "attempt-1", currentStep: 1 }, form, 4));
  form.set("stepIndex", "0");
  assert.throws(() => assertApprovalToken({ module: "WORKFLOW", currentAttemptId: "attempt-1", currentStep: 1 }, form, 4), /thay đổi/);
  const returned = new FormData(); returned.set("reason", "Thiếu hồ sơ"); returned.append("correctionItems", "Bổ sung hóa đơn"); returned.append("correctionItems", "  ");
  assert.deepEqual(correctionItems(returned, "RETURN"), ["Bổ sung hóa đơn"]);
  returned.delete("correctionItems");
  assert.throws(() => correctionItems(returned, "RETURN"), /ít nhất một/);
  assert.deepEqual(correctionItems(returned, "RETURN", { optional: true }), []);
});

test("pending cancellation holds signing and execution", () => {
  const request = { state: "APPROVED", payload: { content: "", counterparty: "", amount: "", linkedRequestId: "", mainFileId: "", cancellation: { status: "PENDING", requestedById: "creator", requestedAt: new Date(0).toISOString(), reason: "Sai hồ sơ" } } };
  assert.throws(() => assertWorkflowLifecycleAllows(request, "SIGN"), /đang chờ/);
  assert.throws(() => assertWorkflowLifecycleAllows(request, "START"), /đang chờ/);
});
