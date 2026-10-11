import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertSettlementReplacementAllowed,
  cancelSettlementLifecycle,
  createSettlementLifecycle,
} from "../lib/costflow/settlementService.ts";

const projectId = "project-settlement-cancel";
const axes = {
  cash: [{ id: "cash-existing", amount: "100" }],
  allocations: [{ id: "allocation-existing", amount: "100" }],
  locks: [],
  evidence: [{ id: "evidence-existing" }],
  exports: [{ id: "export-existing" }],
  approvalState: "DRAFT",
  signingState: "UNSIGNED",
};

function lifecycle() {
  return createSettlementLifecycle({
    projectId,
    dossierId: "dossier",
    versionId: "version-1",
    requestId: "request",
    creatorId: "owner",
    projectOwnerId: "owner",
    expectedVersion: 0,
    steps: [
      { role: "MANAGER", assigneeId: "manager" },
      { role: "ACCOUNTANT", assigneeId: "accountant" },
      { role: "CEO", assigneeId: "ceo" },
    ],
    sourceManifest: { actualCosts: [], advanceAllocations: [] },
    axisSnapshot: axes,
  });
}

test("settlement cancellation: before cash or locks it appends an event without rewriting independent axes", () => {
  const before = lifecycle();
  const cancelled = cancelSettlementLifecycle(before, {
    actorId: "manager",
    expectedVersion: 0,
    reason: "Dừng hồ sơ trước khi phát sinh tiền",
    hasCash: false,
  });
  assert.equal(cancelled.state, "CANCELLED");
  assert.equal(cancelled.events.length, before.events.length + 1);
  assert.deepEqual(cancelled.axisSnapshot, axes);
  assert.deepEqual(cancelled.cashWrites, []);
});

test("settlement cancellation: any cash or lock rejects without changing history", () => {
  const before = lifecycle();
  assert.throws(() => cancelSettlementLifecycle(before, {
    actorId: "manager",
    expectedVersion: 0,
    reason: "Không được hủy",
    hasCash: true,
  }), /tiền|cash/i);
  assert.throws(() => cancelSettlementLifecycle({ ...before, locks: [{
    projectId,
    dossierVersionId: "version-1",
    recipientKey: "USER:owner",
    actualCostApplicationId: "ac-application",
    advanceApplicationId: null,
    sourceCashAllocationId: null,
  }] }, {
    actorId: "manager",
    expectedVersion: 0,
    reason: "Không được hủy",
    hasCash: false,
  }), /khóa|lock/i);
  assert.deepEqual(before.axisSnapshot, axes);
});

test("settlement replacement: server-observed paid or locked state fails closed even when client claims no value change", () => {
  for (const observed of [{ hasCash: true, hasLocks: false }, { hasCash: false, hasLocks: true }]) {
    assert.throws(() => assertSettlementReplacementAllowed({
      oldVersionId: "version-1",
      newVersionId: "version-2",
      actorId: "owner",
      reason: "Client nói chỉ đổi mô tả",
      changesPaidOrLockedValues: false,
      ...observed,
    }), /chưa có thẩm quyền|adjustment|đã chi|đã khóa/i);
  }
});

test("settlement replacement command derives paid and locked gates from persisted counts", () => {
  const source = readFileSync(new URL("../lib/costflow/settlementService.ts", import.meta.url), "utf8");
  assert.match(source, /assertSettlementReplacementAllowed\([\s\S]*hasCash:\s*cashCount\s*>\s*0[\s\S]*hasLocks:\s*lockCount\s*>\s*0/);
  assert.doesNotMatch(source, /changesPaidOrLockedValues:\s*formText/);
  assert.doesNotMatch(source, /releaseSettlement|deleteMany\([\s\S]*settlementLock|Adjustment Settlement[^\n]*create/i);
});
