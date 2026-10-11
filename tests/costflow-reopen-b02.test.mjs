import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planReopenedDossierDelta } from "../lib/costflow/reconciliation.ts";

const prior = {
  stableDossierId: "dossier-1",
  versions: [{
    id: "version-1",
    sources: [{ identity: "AC:approved-v1", recipientKey: "USER:a", amount: "100", provenance: "approval-1" }],
    cash: [{ id: "cash-1", bytes: "cash-bytes" }],
    locks: [{ id: "lock-1", bytes: "lock-bytes" }],
    exports: [{ id: "export-1", bytes: "export-bytes", sha256: "hash-export" }],
    evidence: [{ id: "evidence-1", bytes: "evidence-bytes" }],
    decisions: [{ id: "decision-1", action: "APPROVE" }],
    signatures: [{ id: "signature-1", bytes: "signature-bytes" }],
    hashes: ["hash-approved-snapshot", "hash-qr"],
  }],
};

test("B02 reopen: a Manager-approved reopen adds only genuinely new DD-approved sources under the same dossier", () => {
  const before = structuredClone(prior);
  const result = planReopenedDossierDelta({
    prior,
    requestedDossierId: "dossier-1",
    financialCloseState: "OPEN",
    reopenDecision: { decision: "APPROVE", actorId: "manager" },
    candidates: [{ identity: "AC:approved-v2", recipientKey: "VENDOR:new", amount: "250", provenance: "dd-approval-2", approvalState: "DD_APPROVED" }],
  });
  assert.equal(result.stableDossierId, "dossier-1");
  assert.deepEqual(result.delta.sources.map(source => source.identity), ["AC:approved-v2"]);
  assert.deepEqual(result.delta.baselineVersionIds, ["version-1"]);
  assert.deepEqual(prior, before, "prior cash, locks, exports, evidence, decisions, signatures and hashes stay byte-for-byte unchanged");
});

test("B02 reopen: replay, second dossier, unapproved sources, and paid/locked adjustments fail without side effects", () => {
  const before = structuredClone(prior);
  const base = { prior, requestedDossierId: "dossier-1", financialCloseState: "OPEN", reopenDecision: { decision: "APPROVE", actorId: "manager" } };
  assert.throws(() => planReopenedDossierDelta({ ...base, candidates: [{ identity: "AC:approved-v1", recipientKey: "USER:a", amount: "100", provenance: "approval-1", approvalState: "DD_APPROVED" }] }), /trùng|replay|đã có/i);
  assert.throws(() => planReopenedDossierDelta({ ...base, requestedDossierId: "dossier-2", candidates: [{ identity: "AC:new", recipientKey: "USER:a", amount: "1", provenance: "approval-2", approvalState: "DD_APPROVED" }] }), /một hồ sơ|dossier/i);
  assert.throws(() => planReopenedDossierDelta({ ...base, candidates: [{ identity: "AC:new", recipientKey: "USER:a", amount: "1", provenance: "approval-2", approvalState: "PENDING" }] }), /DD|duyệt/i);
  assert.throws(() => planReopenedDossierDelta({ ...base, changesPaidOrLockedValues: true, candidates: [{ identity: "AC:new", recipientKey: "USER:a", amount: "1", provenance: "approval-2", approvalState: "DD_APPROVED" }] }), /chưa có thẩm quyền|đã chi|đã khóa|adjustment/i);
  assert.deepEqual(prior, before);
});

test("B02 reopen: service exposes one server-derived delta path and never fabricates generic adjustment behavior", () => {
  const source = readFileSync(new URL("../lib/costflow/service.ts", import.meta.url), "utf8");
  assert.match(source, /CREATE_REOPENED_SETTLEMENT_VERSION/);
  assert.match(source, /actualCostLine\.findMany/);
  assert.match(source, /settlementLock\.findMany/);
  assert.match(source, /supersedesId:\s*latestVersion\.id/);
  assert.doesNotMatch(source, /Adjustment Settlement|GENERIC_ADJUSTMENT|unlockSettlement|deleteMany\([^)]*settlement/i);
});
