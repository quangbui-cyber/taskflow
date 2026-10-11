import test from "node:test";
import assert from "node:assert/strict";
import {
  createSettlementCashHarness,
  settlementCashFingerprint,
  settlementObligationDirection,
  validateSettlementCashCommand,
} from "../lib/costflow/settlementCash.ts";
import { projectSettlementPendingDisbursements } from "../lib/costflow/paymentReadModel.ts";

const projectId = "project-settlement-cash";
const versionId = "settlement-version-1";
const recipientKey = "USER:beneficiary";

const additionalObligation = {
  projectId,
  dossierId: "dossier-1",
  dossierVersionId: versionId,
  requestId: "request-1",
  obligationId: "obligation-out",
  recipientKey,
  recipientType: "EMPLOYEE",
  recipientName: "Nguyen Van A",
  bankName: "VCB",
  accountLast4: "1234",
  direction: "OUT",
  amountDue: "12000000",
  locked: true,
  sourceKind: "SETTLEMENT",
};

const refundObligation = {
  ...additionalObligation,
  obligationId: "obligation-in",
  recipientKey: "USER:refund",
  recipientName: "Tran Thi B",
  direction: "IN",
  amountDue: "2000000",
};

function command(overrides = {}) {
  return {
    projectId,
    dossierVersionId: versionId,
    obligationId: additionalObligation.obligationId,
    recipientKey,
    direction: "OUT",
    amount: "5000000",
    idempotencyKey: "settlement-command-1",
    evidenceId: "evidence-1",
    channel: "BANK_TRANSFER",
    reference: "UNC-001",
    occurredAt: "2026-10-11T09:00:00.000Z",
    actorId: "accountant",
    ...overrides,
  };
}

test("settlement cash: positive additional due joins the existing queue with exact immutable provenance", () => {
  const rows = projectSettlementPendingDisbursements({
    obligations: [additionalObligation, refundObligation],
    allocations: [],
  });

  assert.deepEqual(rows, [{
    projectId,
    requestId: "request-1",
    dossierId: "dossier-1",
    dossierVersionId: versionId,
    obligationId: "obligation-out",
    recipientKey,
    recipientType: "EMPLOYEE",
    recipientLabel: "Nguyen Van A",
    bankName: "VCB",
    accountLast4: "1234",
    direction: "OUT",
    approvedAmount: "12000000",
    cumulativePaid: "0",
    remainingAmount: "12000000",
    cashProgress: "CHUA_CHI",
    sourceKind: "SETTLEMENT",
  }]);
});

test("settlement cash: persisted REFUND and ADDITIONAL obligations map to real cash directions", () => {
  assert.equal(settlementObligationDirection("REFUND"), "IN");
  assert.equal(settlementObligationDirection("ADDITIONAL"), "OUT");
  assert.equal(settlementObligationDirection("BALANCED"), null);
  assert.throws(() => settlementObligationDirection("CUSTOMER_AR"), /direction|chiều/i);
});

test("settlement cash: partial installments remain queued until exact zero", async () => {
  const harness = createSettlementCashHarness([additionalObligation]);
  await harness.execute(command());
  let rows = projectSettlementPendingDisbursements(harness.snapshot());
  assert.equal(rows[0].cumulativePaid, "5000000");
  assert.equal(rows[0].remainingAmount, "7000000");
  assert.equal(rows[0].cashProgress, "DANG_CHI_MOT_PHAN");

  await harness.execute(command({
    amount: "7000000",
    idempotencyKey: "settlement-command-2",
    reference: "UNC-002",
  }));
  rows = projectSettlementPendingDisbursements(harness.snapshot());
  assert.deepEqual(rows, []);
  assert.equal(harness.obligationProgress(additionalObligation.obligationId).cashProgress, "DA_CHI_DU");
  assert.equal(harness.dossierProgress(), "DA_CHI_DU");
});

test("settlement cash: validates exact project, recipient, direction, evidence and rejects customer AR", () => {
  const allocations = [];
  assert.throws(() => validateSettlementCashCommand({ obligation: additionalObligation, command: command({ projectId: "foreign" }), allocations }), /Project/i);
  assert.throws(() => validateSettlementCashCommand({ obligation: additionalObligation, command: command({ recipientKey: "USER:other" }), allocations }), /người nhận|recipient/i);
  assert.throws(() => validateSettlementCashCommand({ obligation: additionalObligation, command: command({ direction: "IN" }), allocations }), /chiều|direction/i);
  assert.throws(() => validateSettlementCashCommand({ obligation: additionalObligation, command: command({ evidenceId: "" }), allocations }), /chứng từ|evidence/i);
  assert.throws(() => validateSettlementCashCommand({ obligation: { ...additionalObligation, sourceKind: "CUSTOMER_AR" }, command: command(), allocations }), /Customer AR|khách hàng/i);
});

test("settlement cash: same-key replay is stable and different payload conflicts", async () => {
  const harness = createSettlementCashHarness([additionalObligation]);
  const first = await harness.execute(command());
  const replay = await harness.execute(command());
  assert.equal(replay.idempotent, true);
  assert.equal(replay.cashId, first.cashId);
  assert.equal(harness.snapshot().allocations.length, 1);
  await assert.rejects(
    () => harness.execute(command({ amount: "4000000" })),
    /mã chống ghi trùng|idempotency/i,
  );
  assert.equal(settlementCashFingerprint(command()), settlementCashFingerprint(command()));
});

test("settlement cash: parallel distinct keys cannot overpay and retry after timeout does not duplicate", async () => {
  const harness = createSettlementCashHarness([{ ...additionalObligation, amountDue: "5000000" }]);
  const race = await Promise.allSettled([
    harness.execute(command({ amount: "4000000", idempotencyKey: "race-a", reference: "UNC-race-a" })),
    harness.execute(command({ amount: "4000000", idempotencyKey: "race-b", reference: "UNC-race-b" })),
  ]);
  assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(harness.snapshot().allocations.reduce((sum, item) => sum + BigInt(item.amount), 0n), 4000000n);

  const timeoutHarness = createSettlementCashHarness([additionalObligation], { timeoutAfterCommitKeys: ["timeout-key"] });
  const timeoutCommand = command({ idempotencyKey: "timeout-key", reference: "UNC-timeout" });
  await assert.rejects(() => timeoutHarness.execute(timeoutCommand), /timeout/i);
  const retry = await timeoutHarness.execute(timeoutCommand);
  assert.equal(retry.idempotent, true);
  assert.equal(timeoutHarness.snapshot().allocations.length, 1);
});

test("settlement cash: refund IN is obligation-bound and every obligation must reach zero", async () => {
  const harness = createSettlementCashHarness([additionalObligation, refundObligation]);
  await harness.execute(command({ amount: "12000000" }));
  assert.equal(harness.dossierProgress(), "DANG_CHI_MOT_PHAN");
  await harness.execute(command({
    obligationId: refundObligation.obligationId,
    recipientKey: refundObligation.recipientKey,
    direction: "IN",
    amount: "2000000",
    idempotencyKey: "refund-command",
    reference: "PT-001",
  }));
  assert.equal(harness.dossierProgress(), "DA_CHI_DU");
});
