import test from "node:test";
import assert from "node:assert/strict";
import {
  appendSettlementLocks,
  createSettlementLifecycle,
  decideSettlementLifecycle,
  submitSettlementLifecycle,
} from "../lib/costflow/settlementService.ts";

const projectId = "project-locks";
const steps = [
  { role: "MANAGER", assigneeId: "manager" },
  { role: "ACCOUNTANT", assigneeId: "accountant" },
  { role: "CEO", assigneeId: "ceo" },
];
const sourceManifest = {
  actualCosts: [{ projectId, recipientKey: "USER:owner", applicationId: "ac-app", versionId: "ac-v1", approvalId: "ac-approval" }],
  advanceAllocations: [{ projectId, recipientKey: "USER:owner", applicationId: "advance-app", cashAllocationId: "cash-allocation" }],
};

test("settled lock: CEO approval appends exact-source locks without mutating other state axes", () => {
  const before = {
    actualCostState: "APPROVED",
    advanceRequestState: "APPROVED",
    allocationState: "CONFIRMED",
    cashRows: [{ id: "cash", direction: "OUT", amount: "100" }],
    signingState: "SIGNED",
    taskState: "IN_PROGRESS",
    financialCloseState: "OPEN",
  };
  let lifecycle = createSettlementLifecycle({ projectId, dossierId: "dossier", versionId: "version", requestId: "request", creatorId: "owner", projectOwnerId: "owner", expectedVersion: 0, steps, sourceManifest });
  lifecycle = submitSettlementLifecycle(lifecycle, { actorId: "owner", expectedVersion: 0, blockers: [] });
  lifecycle = decideSettlementLifecycle(lifecycle, { actorId: "manager", expectedVersion: 1, action: "APPROVE", reason: "" });
  lifecycle = decideSettlementLifecycle(lifecycle, { actorId: "accountant", expectedVersion: 2, action: "APPROVE", reason: "" });
  lifecycle = decideSettlementLifecycle(lifecycle, { actorId: "ceo", expectedVersion: 3, action: "APPROVE", reason: "" });

  assert.equal(lifecycle.state, "APPROVED");
  assert.deepEqual(lifecycle.cashWrites, []);
  assert.deepEqual(lifecycle.axisSnapshot, before);
  assert.deepEqual(lifecycle.locks.map(lock => ({
    actualCostApplicationId: lock.actualCostApplicationId,
    advanceApplicationId: lock.advanceApplicationId,
    sourceCashAllocationId: lock.sourceCashAllocationId,
  })), [
    { actualCostApplicationId: "ac-app", advanceApplicationId: null, sourceCashAllocationId: null },
    { actualCostApplicationId: null, advanceApplicationId: "advance-app", sourceCashAllocationId: "cash-allocation" },
  ]);
});

test("settled lock: duplicate producer locking and cross-project sources fail closed", () => {
  assert.throws(() => appendSettlementLocks({ projectId, dossierVersionId: "version", sourceManifest: {
    actualCosts: [sourceManifest.actualCosts[0], sourceManifest.actualCosts[0]],
    advanceAllocations: [],
  } }), /trùng|duplicate|đã khóa/i);
  assert.throws(() => appendSettlementLocks({ projectId, dossierVersionId: "version", sourceManifest: {
    actualCosts: [{ ...sourceManifest.actualCosts[0], projectId: "foreign" }],
    advanceAllocations: [],
  } }), /project/i);
});

test("settled lock: lock builder never creates cash or writes SETTLED to producer statuses", () => {
  const result = appendSettlementLocks({ projectId, dossierVersionId: "version", sourceManifest });
  assert.deepEqual(result.cashWrites, []);
  assert.equal(Object.values(result).includes("SETTLED"), false);
  assert.equal(result.locks.length, 2);
});
