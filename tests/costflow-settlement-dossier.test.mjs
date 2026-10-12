import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSettlementReplacementAllowed,
  assertSettlementEvidenceProject,
  createSettlementLifecycle,
  decideSettlementLifecycle,
  prepareSettlementEvidence,
  resubmitSettlementLifecycle,
  submitSettlementLifecycle,
  cancelSettlementLifecycle,
} from "../lib/costflow/settlementService.ts";

const projectId = "project-settlement-lifecycle";
const ownerId = "owner";
const steps = [
  { role: "MANAGER", assigneeId: "manager" },
  { role: "ACCOUNTANT", assigneeId: "accountant" },
  { role: "CEO", assigneeId: "ceo" },
];
const sourceManifest = {
  actualCosts: [{ projectId, recipientKey: "USER:owner", applicationId: "ac-app", versionId: "ac-v1", approvalId: "ac-approval" }],
  advanceAllocations: [{ projectId, recipientKey: "USER:owner", applicationId: "advance-app", cashAllocationId: "cash-allocation" }],
};

function draft() {
  return createSettlementLifecycle({
    projectId,
    dossierId: "dossier",
    versionId: "version-1",
    requestId: "request-1",
    creatorId: ownerId,
    projectOwnerId: ownerId,
    expectedVersion: 0,
    steps,
    sourceManifest,
  });
}

test("settlement dossier: only the server-derived Project owner creates and submits", () => {
  assert.throws(() => createSettlementLifecycle({
    projectId,
    dossierId: "dossier",
    versionId: "version-forged",
    requestId: "request-forged",
    creatorId: "forged",
    projectOwnerId: ownerId,
    expectedVersion: 0,
    steps,
    sourceManifest,
  }), /owner|phụ trách|người lập/i);
  assert.throws(
    () => submitSettlementLifecycle(draft(), { actorId: "forged", expectedVersion: 0, blockers: [] }),
    /người lập|creator/i,
  );
});

test("settlement dossier: Manager -> Accountant -> CEO is sequential and return/resubmit creates a new immutable attempt", () => {
  const submitted = submitSettlementLifecycle(draft(), { actorId: ownerId, expectedVersion: 0, blockers: [] });
  assert.equal(submitted.state, "SUBMITTED");
  assert.throws(
    () => decideSettlementLifecycle(submitted, { actorId: "accountant", expectedVersion: 1, action: "APPROVE", reason: "" }),
    /phân công|bước hiện tại/i,
  );
  const managerApproved = decideSettlementLifecycle(submitted, { actorId: "manager", expectedVersion: 1, action: "APPROVE", reason: "" });
  const returned = decideSettlementLifecycle(managerApproved, { actorId: "accountant", expectedVersion: 2, action: "RETURN", reason: "Thiếu biên bản" });
  assert.equal(returned.state, "RETURNED");
  assert.notEqual(returned.attemptId, "");
  const resubmitted = resubmitSettlementLifecycle(returned, { actorId: ownerId, expectedVersion: 3, blockers: [] });
  assert.equal(resubmitted.state, "SUBMITTED");
  assert.notEqual(resubmitted.attemptId, returned.attemptId);
  assert.deepEqual(resubmitted.priorAttempts.at(-1), {
    attemptId: returned.attemptId,
    state: "RETURNED",
    reason: "Thiếu biên bản",
  });
  assert.equal(resubmitted.currentStep, 0);
});

test("settlement dossier: submit diagnostics remain distinct and lifecycle is cash neutral", () => {
  const lifecycle = draft();
  assert.throws(
    () => submitSettlementLifecycle(lifecycle, {
      actorId: ownerId,
      expectedVersion: 0,
      blockers: [
        { code: "UNAPPROVED_AC", recipientKey: "USER:owner" },
        { code: "MISSING_RELATED_IC_AC", recipientKey: "USER:owner" },
        { code: "MISSING_EXPENSE_EVIDENCE", recipientKey: "USER:owner" },
        { code: "MISSING_DISBURSEMENT_PROOF", recipientKey: "USER:owner" },
      ],
    }),
    error => {
      assert.deepEqual(error.codes, [
        "UNAPPROVED_AC",
        "MISSING_RELATED_IC_AC",
        "MISSING_EXPENSE_EVIDENCE",
        "MISSING_DISBURSEMENT_PROOF",
      ]);
      return true;
    },
  );
  assert.deepEqual(lifecycle.cashWrites, []);
});

test("settlement dossier: PDF/XLSX/JPG/PNG evidence is content-checked, hashed and version-bound", () => {
  const cases = [
    ["report.pdf", "application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
    ["report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
    ["receipt.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xdb])],
    ["receipt.png", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ];
  for (const [name, mimeType, data] of cases) {
    const evidence = prepareSettlementEvidence({ projectId, dossierVersionId: "version-1", actorId: ownerId, name, mimeType, data });
    assert.equal(evidence.projectId, projectId);
    assert.equal(evidence.dossierVersionId, "version-1");
    assert.equal(evidence.addedById, ownerId);
    assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
  }
  assert.throws(
    () => prepareSettlementEvidence({ projectId, dossierVersionId: "version-1", actorId: ownerId, name: "fake.pdf", mimeType: "application/pdf", data: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) }),
    /nội dung|magic|định dạng/i,
  );
  assert.throws(() => assertSettlementEvidenceProject({
    dossierProjectId: projectId,
    evidenceProjectId: "foreign-project",
    dossierVersionId: "version-1",
    evidenceVersionId: "version-1",
  }), /project|phiên bản/i);
});

test("settlement dossier: Manager cancellation is append-only and replacement preserves old lineage", () => {
  const cancelled = cancelSettlementLifecycle(draft(), { actorId: "manager", expectedVersion: 0, reason: "Dừng hồ sơ", hasCash: false });
  assert.equal(cancelled.state, "CANCELLED");
  assert.equal(cancelled.events.at(-1).action, "CANCEL");
  assert.throws(
    () => cancelSettlementLifecycle(cancelled, { actorId: "manager", expectedVersion: 1, reason: "Dừng lần nữa", hasCash: false }),
    /cancelled|đã hủy|trạng thái/i,
  );
  assert.equal(cancelled.events.filter(event => event.action === "CANCEL").length, 1);
  assert.throws(() => cancelSettlementLifecycle(draft(), { actorId: "manager", expectedVersion: 0, reason: "Dừng", hasCash: true }), /tiền|cash/i);

  const replacement = assertSettlementReplacementAllowed({
    oldVersionId: "version-1",
    newVersionId: "version-2",
    actorId: ownerId,
    reason: "Bổ sung mô tả",
    changesPaidOrLockedValues: false,
  });
  assert.deepEqual({
    supersedesId: replacement.supersedesId,
    replacedById: replacement.replacedById,
    replacementActorId: replacement.replacementActorId,
    replacementReason: replacement.replacementReason,
  }, {
    supersedesId: "version-1",
    replacedById: "version-2",
    replacementActorId: ownerId,
    replacementReason: "Bổ sung mô tả",
  });
  assert.match(replacement.replacedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.throws(() => assertSettlementReplacementAllowed({
    oldVersionId: "version-1",
    newVersionId: "version-1",
    actorId: ownerId,
    reason: "Không được tự thay chính mình",
    changesPaidOrLockedValues: false,
  }), /khác|distinct|phiên bản mới/i);
  assert.throws(() => assertSettlementReplacementAllowed({
    oldVersionId: "version-1",
    newVersionId: "version-2",
    actorId: ownerId,
    reason: "Đổi số tiền",
    changesPaidOrLockedValues: true,
  }), /chưa có thẩm quyền|adjustment|đã chi|đã khóa/i);
});
