import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildProjectSettlementDraft,
  projectSettlementLifecycleCashEffects,
  roundSettlementVnd,
} from "../lib/costflow/projectSettlement.ts";
import {
  assertSettlementReplacementAllowed,
  createSettlementLifecycle,
} from "../lib/costflow/settlementService.ts";
import { settlementObligationProgress } from "../lib/costflow/settlementCash.ts";
import { planReopenedDossierDelta, twoWayCloseBlockers } from "../lib/costflow/reconciliation.ts";
import { SETTLEMENT_EXPORT_FAMILIES, normalizeSettlementExportProjection } from "../lib/costflow/export.ts";
import {
  assertOpaquePublicVerificationToken,
  buildSettlementPrintDocument,
  settlementProjectionHash,
} from "../lib/costflow/settlementSecurity.ts";

const projectId = "phase10-project";

function actual(overrides = {}) {
  return {
    projectId,
    recipientKey: "USER:account",
    recipientType: "EMPLOYEE",
    recipientName: "Account",
    stableLineId: "ac-line",
    versionId: "ac-version",
    approvalEventId: "approval-event",
    approvalAttemptId: "approval-attempt",
    currentApprovalTuple: { versionId: "ac-version", approvalEventId: "approval-event", approvalAttemptId: "approval-attempt" },
    approvalState: "APPROVED",
    rawNet: "20000001/2",
    rawVat: "1600001/2",
    rawGross: "10800001",
    relatedIcAcReferences: [{ id: "ic-line", kind: "IC_LINE" }],
    evidence: [{ id: "invoice", sha256: "a".repeat(64), origin: "INHERITED", satisfies: ["EXPENSE_EVIDENCE"] }],
    ...overrides,
  };
}

function advance(overrides = {}) {
  return {
    projectId,
    recipientKey: "USER:account",
    recipientType: "EMPLOYEE",
    recipientName: "Account",
    advanceRequestId: "advance-request",
    advanceLineId: "advance-line",
    cashId: "cash-out",
    allocationId: "cash-allocation",
    direction: "OUT",
    cashState: "CONFIRMED",
    rawGross: "12000000",
    evidence: [{ id: "cash-proof", sha256: "b".repeat(64), origin: "INHERITED", satisfies: ["DISBURSEMENT_PROOF"] }],
    ...overrides,
  };
}

function projection(family = "PROJECT_SETTLEMENT") {
  return {
    projectId,
    projectName: "Phase 10",
    family,
    source: {
      dossierId: "dossier",
      dossierVersionId: "dossier-version-2",
      dossierVersion: 2,
      documentVersionId: "document-version-4",
      documentVersion: 4,
      state: "APPROVED",
      supersedesId: "dossier-version-1",
      replacedById: null,
      replacementReason: "B02 reopen",
    },
    title: "Quyết toán dự án",
    approvedAt: "2026-10-11T00:00:00.000Z",
    totals: { rawNet: "20000001/2", rawVat: "1600001/2", rawGross: "10800001", net: "10000001", vat: "800000", gross: "10800001" },
    recipients: [{ recipientKey: "USER:account", recipientType: "EMPLOYEE", displayName: "Account", actualGross: "10800001", advanceGross: "12000000", refundDue: "1199999", additionalDue: "0" }],
    items: [{ stableLineId: "ac-line", description: "Thi công", recipientKey: "USER:account", rawNet: "20000001/2", rawVat: "1600001/2", rawGross: "10800001", net: "10000001", vat: "800000", gross: "10800001" }],
    obligations: [{ recipientKey: "USER:account", direction: "REFUND", amountDue: "1199999" }],
    evidence: [{ id: "invoice", kind: "EXPENSE_EVIDENCE", sha256: "a".repeat(64) }],
    signingSnapshot: { id: "document-version-4", state: "CHO_KY", projectionSha256: "c".repeat(64), events: [] },
  };
}

test("SET-01/02: warnings and all three fixed evidence diagnostics stay distinct while lifecycle is cash-neutral", () => {
  const draft = buildProjectSettlementDraft({
    projectId,
    actualCostLines: [actual({ relatedIcAcReferences: [], evidence: [] }), actual({ stableLineId: "pending", versionId: "pending-v", approvalState: "PENDING", approvalEventId: null, approvalAttemptId: null, currentApprovalTuple: null })],
    advanceAllocations: [advance({ evidence: [] })],
  });
  assert.deepEqual(draft.warnings.map(item => item.code), ["UNAPPROVED_AC"]);
  assert.deepEqual(draft.recipients[0].evidenceCompleteness.missingCodes, ["MISSING_RELATED_IC_AC", "MISSING_EXPENSE_EVIDENCE", "MISSING_DISBURSEMENT_PROOF"]);
  for (const action of ["CREATE", "SUBMIT", "APPROVE", "RETURN", "REPLACE"]) assert.deepEqual(projectSettlementLifecycleCashEffects(action), []);
  const lifecycle = createSettlementLifecycle({ projectId, dossierId: "dossier", versionId: "v1", requestId: "request", creatorId: "owner", projectOwnerId: "owner", expectedVersion: 0, steps: [{ role: "MANAGER", assigneeId: "manager" }, { role: "ACCOUNTANT", assigneeId: "accountant" }, { role: "CEO", assigneeId: "ceo" }], sourceManifest: { actualCosts: [], advanceAllocations: [] }, axisSnapshot: { actualCostState: "APPROVED", advanceRequestState: "APPROVED", allocationState: "CONFIRMED", cashRows: [], signingState: "UNSIGNED", taskState: "DONE", financialCloseState: "OPEN" } });
  assert.equal(lifecycle.axisSnapshot.taskState, "DONE");
  assert.equal(lifecycle.axisSnapshot.financialCloseState, "OPEN");
  assert.deepEqual(lifecycle.cashWrites, []);
});

test("SET-03/04: partial settlement cash and two-way close remain independently enforced", () => {
  assert.deepEqual(settlementObligationProgress("2400000", "1000000"), { approvedAmount: "2400000", cumulativePaid: "1000000", remainingAmount: "1400000", cashProgress: "DANG_CHI_MOT_PHAN" });
  const blockers = twoWayCloseBlockers({
    dossier: { id: "dossier", versionId: "v1", state: "APPROVED", sourceCount: 2, lockCount: 2 },
    obligations: [{ recipientKey: "USER:account", amountDue: "2400000", allocatedAmount: "1000000", everyCashHasEvidence: true }],
    customerAccounting: { currentLiquidation: { id: "liq", documentNumber: "TL-01", signedAt: "2026-10-11", evidence: { id: "signed" } }, receivable: { outstandingGross: "500000" } },
  });
  assert.ok(blockers.some(item => /công nợ nội bộ/.test(item)));
  assert.ok(blockers.some(item => /Customer AR/.test(item)));
});

test("SET-05: reopen keeps one dossier, prior history immutable and paid/locked adjustment blocked", () => {
  const prior = { stableDossierId: "dossier", versions: [{ id: "v1", sources: [{ identity: "AC:old", recipientKey: "USER:account", amount: "100", provenance: "approval-old" }], cash: ["cash-bytes"], exports: ["export-bytes"], hashes: ["old-hash"] }] };
  const before = structuredClone(prior);
  const next = planReopenedDossierDelta({ prior, requestedDossierId: "dossier", financialCloseState: "OPEN", reopenDecision: { decision: "APPROVE", actorId: "manager" }, candidates: [{ identity: "AC:new", recipientKey: "VENDOR:new", amount: "250", provenance: "approval-new", approvalState: "DD_APPROVED" }] });
  assert.equal(next.stableDossierId, "dossier");
  assert.deepEqual(next.delta.sources.map(item => item.identity), ["AC:new"]);
  assert.deepEqual(prior, before);
  assert.throws(() => assertSettlementReplacementAllowed({ oldVersionId: "v1", newVersionId: "v2", actorId: "owner", reason: "Sửa", changesPaidOrLockedValues: true, hasCash: true, hasLocks: true }), /đã chi|đã khóa|thẩm quyền|adjustment/i);
});

test("SET-06: six XLSX/PDF families share exact rounded totals, words and opaque QR authority", () => {
  assert.deepEqual(SETTLEMENT_EXPORT_FAMILIES, ["QUOTATION", "CUSTOMER_ACCEPTANCE", "DNTU", "DNTT", "DNHTU", "PROJECT_SETTLEMENT"]);
  assert.equal(roundSettlementVnd("100.5"), "101");
  assert.equal(roundSettlementVnd("-100.5"), "-101");
  for (const family of SETTLEMENT_EXPORT_FAMILIES) {
    const normalized = normalizeSettlementExportProjection(projection(family));
    const printable = buildSettlementPrintDocument({ projection: projection(family), signingEvents: [] });
    assert.equal(normalized.totals.gross, printable.approvedGross);
    assert.equal(normalized.moneyInWords, printable.moneyInWords);
    assert.equal(printable.signingState, "UNSIGNED");
  }
  assert.throws(() => assertOpaquePublicVerificationToken("dossier-version-2"), /opaque|token|không hợp lệ/i);
  assert.doesNotThrow(() => assertOpaquePublicVerificationToken("x".repeat(43)));
  assert.notEqual(settlementProjectionHash(projection()), settlementProjectionHash({ ...projection(), items: [{ ...projection().items[0], recipientKey: "VENDOR:changed" }] }));
});

test("routes expose exactly six authorized XLSX and six version-bound print families", () => {
  const xlsx = readFileSync(new URL("../app/api/projects/[id]/costflow/export/[type]/route.ts", import.meta.url), "utf8");
  const print = readFileSync(new URL("../app/projects/[id]/costflow/[type]/[version]/print/page.tsx", import.meta.url), "utf8");
  for (const family of ["quotation", "customer-acceptance", "dntu", "dntt", "dnhtu", "project-settlement"]) {
    assert.match(xlsx, new RegExp(`(?:"${family}"|${family}):`));
    assert.match(print, new RegExp(`(?:"${family}"|${family}):`));
  }
  assert.match(xlsx, /versionId/);
  assert.match(print, /requestedVersionId/);
});
