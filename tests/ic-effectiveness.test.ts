import test from "node:test";
import assert from "node:assert/strict";
import { calculateCost } from "../lib/costflow/money";
import { readableIcRevisionDiff } from "../lib/costflow/budgetRevisions";
import { effectiveBaseline, icDecisionPolicy, icStatusProjection } from "../lib/costflow/icEffectiveness";
import type { IcRevision } from "../lib/costflow/types";

const line = (id: string, overrides: Record<string, unknown> = {}) => {
  const input = { quantity: "1", unitPrice: "100", basis: "NET" as const, vatPercent: "8" };
  return { id, description: `Dòng ${id}`, unit: "gói", ...input, cost: calculateCost(input), ...overrides };
};

const revision = (id: string, number: number, effective: boolean, lines = [line("line-1")]): IcRevision => ({
  id, number, requestId: `request-${id}`, effective, lines, poIds: [], briefIds: [], evidenceIds: [], createdBy: "account",
});

test("effective baseline is explicit and rejects multiple active revisions", () => {
  const baseline = revision("baseline", 1, true);
  assert.equal(effectiveBaseline([revision("draft", 2, false), baseline])?.id, "baseline");
  assert.equal(effectiveBaseline([revision("draft", 2, false)]), undefined);
  assert.throws(() => effectiveBaseline([baseline, revision("other", 2, true)]), /nhiều IC hiệu lực/);
});

test("readable diff groups added, removed and changed values without raw keys", () => {
  const before = revision("before", 1, true, [line("changed"), line("removed")]);
  const after = revision("after", 2, false, [line("changed", { quantity: "2", unitPrice: "125", vatPercent: "10", quotationId: "bg-2", vendorId: "vendor-2", originLines: [{ revisionId: "before", lineId: "changed" }] }), line("added")]);
  const diff = readableIcRevisionDiff(after, before);
  assert.deepEqual(new Set(diff.rows.map(row => row.group)), new Set(["added", "removed", "changed"]));
  assert.ok(diff.rows.some(row => row.fieldLabel === "Số lượng" && row.oldValue === "1" && row.newValue === "2"));
  assert.ok(diff.rows.some(row => row.fieldLabel === "Đơn giá" && row.newValue === "125"));
  assert.ok(diff.rows.some(row => row.fieldLabel === "VAT" && row.newValue === "10%"));
  assert.ok(diff.rows.some(row => row.fieldLabel === "Báo giá nguồn" && row.newValue === "bg-2"));
  assert.ok(diff.rows.some(row => row.fieldLabel === "Nhà cung cấp" && row.newValue === "vendor-2"));
  assert.ok(diff.rows.some(row => row.fieldLabel === "Liên kết dòng IC" && row.newValue.includes("before / changed")));
  assert.deepEqual(readableIcRevisionDiff(after).rows, []);
});

test("CEO IC optional-note policy is narrow", () => {
  assert.equal(icDecisionPolicy("IC", "CEO", "RETURN").reasonOptional, true);
  assert.equal(icDecisionPolicy("IC", "CEO", "REJECT").correctionsOptional, true);
  assert.equal(icDecisionPolicy("IC", "MANAGER", "RETURN").reasonOptional, false);
  assert.equal(icDecisionPolicy("ADVANCE", "CEO", "RETURN").reasonOptional, false);
});

test("two-axis projection keeps later approval separate from Manager effect", () => {
  const active = revision("active", 2, true);
  const steps = [{ role: "MANAGER", assigneeId: "m" }, { role: "ACCOUNTANT", assigneeId: "a" }, { role: "CEO", assigneeId: "c" }];
  const waitingAccountant = icStatusProjection(active, { id: active.requestId, state: "SUBMITTED", currentStep: 1, steps }, [active]);
  assert.equal(waitingAccountant.budgetLabel, "Đang có hiệu lực");
  assert.equal(waitingAccountant.approvalLabel, "Chờ Kế toán");
  const returned = icStatusProjection(active, { id: active.requestId, state: "RETURNED", currentStep: 2, steps }, [active]);
  assert.equal(returned.budgetLabel, "Đang có hiệu lực");
  assert.match(returned.message, /không tự vô hiệu/);
  const draft = revision("draft", 3, false);
  const draftStatus = icStatusProjection(draft, { id: draft.requestId, state: "DRAFT", currentStep: 0, steps: [] }, [active, draft]);
  assert.equal(draftStatus.approvalLabel, "Nháp");
  assert.match(draftStatus.message, /IC-R2/);
});
