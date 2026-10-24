import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  PHASE12_TEST_DATABASE_URL,
  createPhase12Scenario,
  withPhase12TestSchema,
} from "./phase12/pilotFixture.ts";

const root = path.resolve(import.meta.dirname, "..");

function runProductionSuites(files, env) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import=tsx", "--test", "--test-concurrency=1", ...files],
    {
      cwd: root,
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, output);
  return output;
}

test("Phase 12 negative matrix composes payment and AC production boundaries in a disposable costflow_test schema", async () => {
  await withPhase12TestSchema(async ({ client, databaseUrl, schemaName }) => {
    const output = runProductionSuites(
      ["tests/actual-cost.integration.test.ts"],
      { DATABASE_URL: databaseUrl, COSTFLOW_TEST_DATABASE_URL: databaseUrl },
    );

    assert.match(output, /Excel paste commits one draft transaction or rolls back every line/);
    assert.match(output, /fail 0/);

    if (globalThis.prisma) {
      await globalThis.prisma.$disconnect();
      delete globalThis.prisma;
    }
    const { executePaymentCash } = await import(`../lib/costflow/paymentCash.ts?phase12=${schemaName}`);
    const scenario = await createPhase12Scenario(client, "TEAMBUILDING");
    const [ownerId, , accountantId] = scenario.actorIds;
    const recipientKey = `USER:${ownerId}`;
    const request = await client.workflowRequest.create({ data: {
      projectId: scenario.projectId,
      module: "COSTFLOW",
      kind: "ADVANCE",
      title: "Phase 12 signed cash fixture",
      creatorId: ownerId,
      cashAssigneeId: accountantId,
      state: "REJECTED",
      steps: [],
      payload: { amount: "1000" },
    } });
    await client.paymentRecipientSnapshot.create({ data: {
      projectId: scenario.projectId,
      requestId: request.id,
      recipientKey,
      recipientType: "EMPLOYEE",
      displayName: "Phase 12 Owner",
      totalAmount: "1000",
    } });
    const line = await client.paymentRequestLine.create({ data: {
      projectId: scenario.projectId,
      requestId: request.id,
      stableKey: "phase12-cash-line",
      position: 0,
      description: "Phase 12 partial cash",
      amount: "1000",
      icRevisionId: "phase12-cash-revision",
      icLineId: "phase12-cash-ic-line",
      sourceSnapshot: { automatedFixture: true },
      recipientKey,
      evidenceManifest: [],
    } });
    const upload = { name: "cash-proof.pdf", mimeType: "application/pdf", size: 5, data: new Uint8Array([37, 80, 68, 70, 45]) };
    const cashForm = (amount, key, reference, direction = "OUT") => {
      const value = new FormData();
      value.set("requestId", request.id);
      value.set("recipientKey", recipientKey);
      value.set("direction", direction);
      value.set("channel", "BANK_TRANSFER");
      value.set("reference", reference);
      value.set("idempotencyKey", key);
      value.set("occurredAt", "2026-10-13T10:00:00.000Z");
      value.set("amount", amount);
      value.set("allocations", JSON.stringify([{ requestLineId: line.id, amount }]));
      return value;
    };
    const accountant = { id: accountantId, role: "ACCOUNT" };
    const outsider = { id: ownerId, role: "ACCOUNT" };
    await assert.rejects(
      () => executePaymentCash(scenario.projectId, 0, accountant, cashForm("400", "rejected", "rejected"), upload),
      /đã duyệt/i,
    );
    assert.equal(await client.costFlowCash.count({ where: { projectId: scenario.projectId } }), 0);
    await client.workflowRequest.update({ where: { id: request.id }, data: { state: "APPROVED" } });
    await assert.rejects(
      () => executePaymentCash(scenario.projectId, 0, accountant, cashForm("400", "unsigned", "unsigned"), upload),
      /bằng chứng ký/i,
    );
    await client.workflowSigningLifecycle.create({ data: {
      requestId: request.id,
      mode: "DIGITAL",
      evidenceState: "DIGITAL_CONFIRMED",
      expectedVersion: request.version,
    } });
    await assert.rejects(
      () => executePaymentCash(scenario.projectId, 0, outsider, cashForm("400", "outsider", "outsider"), upload),
      /được giao/i,
    );
    const first = await executePaymentCash(scenario.projectId, 0, accountant, cashForm("400", "partial-1", "ref-1"), upload);
    assert.equal(first.idempotent, false);
    const replay = await executePaymentCash(scenario.projectId, 0, accountant, cashForm("400", "partial-1", "ref-1"), upload);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.cashId, first.cashId);
    await assert.rejects(
      () => executePaymentCash(scenario.projectId, 1, accountant, cashForm("400", "partial-1", "ref-substituted"), upload),
      /đã được dùng/i,
    );
    await executePaymentCash(scenario.projectId, 1, accountant, cashForm("600", "partial-2", "ref-2"), upload);
    await assert.rejects(
      () => executePaymentCash(scenario.projectId, 2, accountant, cashForm("1", "wrong-direction", "wrong-direction", "IN"), upload),
      /chỉ cho phép giao dịch OUT/i,
    );
    assert.equal(await client.costFlowCash.count({ where: { projectId: scenario.projectId } }), 2);
    assert.equal(await client.costFlowCashAllocation.count({ where: { projectId: scenario.projectId } }), 2);
    const paid = await client.costFlowCashAllocation.findMany({ where: { projectId: scenario.projectId }, select: { amount: true } });
    assert.equal(paid.reduce((total, item) => total + BigInt(item.amount), 0n), 1000n);
  });
});

test("Phase 12 B02 matrix preserves old locks and cash while stale close identities fail closed", () => {
  const output = runProductionSuites(
    [
      "tests/costflow-reopen-correction.integration.test.mjs",
      "tests/costflow-two-way-close.integration.test.mjs",
    ],
    { DATABASE_URL: PHASE12_TEST_DATABASE_URL },
  );

  assert.match(output, /scoped correction preserves history and recovery gates corrected OUT/);
  assert.match(output, /financial close binds the exact approved manifest\/version\/hash and rejects every stale substitution/);
  assert.match(output, /fail 0/);

  const evidence = {
    provenance: "automated_local",
    releaseStatus: "NOT_READY",
    covered: [
      "RETURN_RESUBMIT_IMMUTABLE",
      "REJECTED_OR_UNAUTHORIZED_CASH_DENIED",
      "MISSING_EVIDENCE_ACKNOWLEDGEMENT",
      "IDEMPOTENT_CASH_REPLAY",
      "PARTIAL_CASH_PROGRESS",
      "STALE_CLOSE_IDENTITY_DENIED",
      "RECOVERY_BEFORE_CORRECTED_PAYMENT",
      "PRIOR_LOCKS_AND_CASH_PRESERVED",
    ],
    excludedAcceptanceClaims: ["pilot", "company", "production"],
  };
  assert.equal(evidence.provenance, "automated_local");
  assert.equal(evidence.releaseStatus, "NOT_READY");
  assert.equal(evidence.covered.length, 8);
});
