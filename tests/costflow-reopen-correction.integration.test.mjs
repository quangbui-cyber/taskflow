import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const PINNED_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withMigratedSchema(run) {
  const schemaName = `phase10_correction_${randomUUID().replaceAll("-", "")}`;
  const disposableUrl = `${PINNED_DATABASE_URL}?schema=${schemaName}`;
  const admin = new PrismaClient({ datasources: { db: { url: PINNED_DATABASE_URL } } });
  let client;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: disposableUrl },
      encoding: "utf8",
      stdio: "pipe",
    });
    process.env.DATABASE_URL = disposableUrl;
    client = new PrismaClient({ datasources: { db: { url: disposableUrl } } });
    const correction = await import(`../lib/costflow/settlementService.ts?schema=${schemaName}`);
    const cash = await import(`../lib/costflow/settlementCash.ts?schema=${schemaName}`);
    const readModel = await import(`../lib/costflow/paymentReadModel.ts?schema=${schemaName}`);
    await run({ client, correction, cash, readModel });
  } finally {
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
}

async function user(client, label, role = "USER") {
  const id = `${label}-${randomUUID()}`;
  return client.user.create({ data: { id, email: `${id}@example.test`, name: label, passwordHash: "test", role } });
}

const financeData = (accountantId, managerId, ceoId) => ({
  config: { accountantId, managerId, ceoId, operationUserIds: [] },
  closed: false,
  revisions: [], beneficiaries: [], expenses: [], pos: [], quotations: [], briefs: [], vendorPaymentMilestones: [],
});

async function fixture(client, label) {
  const actors = {
    owner: await user(client, `${label}-owner`, "ACCOUNT"),
    manager: await user(client, `${label}-manager`),
    unrelatedManager: await user(client, `${label}-other-manager`),
    accountant: await user(client, `${label}-accountant`, "ACCOUNT"),
    ceo: await user(client, `${label}-ceo`),
    wrong: await user(client, `${label}-wrong`),
    correct: await user(client, `${label}-correct`),
  };
  const project = await client.project.create({ data: {
    name: `Correction ${label}`,
    ownerId: actors.owner.id,
    members: { create: [actors.owner, actors.manager, actors.accountant, actors.ceo, actors.wrong, actors.correct].map(member => ({ userId: member.id })) },
  } });
  await client.costFlowWorkspace.create({ data: { projectId: project.id, data: financeData(actors.accountant.id, actors.manager.id, actors.ceo.id) } });
  const request = await client.workflowRequest.create({ data: {
    projectId: project.id, module: "COSTFLOW", kind: "SETTLEMENT", title: `Settlement ${label}`,
    creatorId: actors.owner.id, cashAssigneeId: actors.accountant.id, state: "APPROVED", version: 4,
    currentAttemptId: `old-attempt-${label}`,
    steps: [{ role: "MANAGER", assigneeId: actors.manager.id }, { role: "ACCOUNTANT", assigneeId: actors.accountant.id }, { role: "CEO", assigneeId: actors.ceo.id }], payload: {},
  } });
  const dossier = await client.projectSettlementDossier.create({ data: { projectId: project.id, createdById: actors.owner.id } });
  const version = await client.projectSettlementVersion.create({ data: {
    projectId: project.id, dossierId: dossier.id, requestId: request.id, version: 1,
    attemptId: `old-attempt-${label}`, canonicalHash: createHash("sha256").update(`old-${label}`).digest("hex"), createdById: actors.owner.id,
  } });
  const original = await client.settlementRecipientObligation.create({ data: {
    projectId: project.id, dossierVersionId: version.id, recipientKey: `USER:${actors.wrong.id}`,
    recipientType: "EMPLOYEE", direction: "ADDITIONAL", approvedAcGross: "1000", disbursedAdvance: "0", amountDue: "1000",
  } });
  const advanceRequest = await client.workflowRequest.create({ data: {
    projectId: project.id, module: "COSTFLOW", kind: "ADVANCE", title: `Advance ${label}`,
    creatorId: actors.owner.id, cashAssigneeId: actors.accountant.id, state: "APPROVED", steps: [], payload: {},
  } });
  await client.paymentRecipientSnapshot.create({ data: {
    projectId: project.id, requestId: advanceRequest.id, recipientKey: original.recipientKey,
    recipientType: "EMPLOYEE", displayName: "Wrong recipient", totalAmount: "1000",
  } });
  const advanceLine = await client.paymentRequestLine.create({ data: {
    projectId: project.id, requestId: advanceRequest.id, stableKey: `advance-${label}`, position: 0,
    description: "Advance source", amount: "1000", icRevisionId: `ic-${label}`, icLineId: `ic-line-${label}`,
    sourceSnapshot: {}, recipientKey: original.recipientKey, evidenceManifest: [],
  } });
  const advance = await client.advanceApplication.create({ data: {
    projectId: project.id, advanceRequestId: advanceRequest.id, advanceLineId: advanceLine.id,
    expenseId: `expense-${label}`, recipientKey: original.recipientKey, amount: "1000", createdBy: actors.owner.id,
  } });
  const sourceCash = await client.costFlowCash.create({ data: {
    projectId: project.id, requestId: advanceRequest.id, recipientKey: original.recipientKey, direction: "OUT",
    channel: "BANK_TRANSFER", amount: "1000", reference: `SOURCE-${label}`, idempotencyKey: `source-${label}`,
    commandFingerprint: "e".repeat(64), allocations: [], evidenceId: `source-evidence-${label}`,
    occurredAt: new Date("2026-09-01T00:00:00.000Z"), confirmedBy: actors.accountant.id,
  } });
  const sourceAllocation = await client.costFlowCashAllocation.create({ data: {
    projectId: project.id, cashId: sourceCash.id, requestId: advanceRequest.id, requestLineId: advanceLine.id,
    recipientKey: original.recipientKey, direction: "OUT", amount: "1000",
  } });
  await client.settlementLock.create({ data: {
    projectId: project.id, dossierVersionId: version.id, obligationId: original.id, recipientKey: original.recipientKey,
    advanceApplicationId: advance.id, sourceCashAllocationId: sourceAllocation.id,
  } });
  const evidence = await client.costFlowEvidence.create({ data: {
    projectId: project.id, requestId: request.id, sourceFileId: `old-${label}`, kind: "CASH", name: "old.pdf",
    mimeType: "application/pdf", data: Buffer.from("old-proof"), sha256: createHash("sha256").update("old-proof").digest("hex"), createdBy: actors.accountant.id,
  } });
  const oldCash = await client.costFlowCash.create({ data: {
    projectId: project.id, requestId: request.id, recipientKey: original.recipientKey, direction: "OUT", channel: "BANK_TRANSFER",
    amount: "1000", reference: `OLD-${label}`, idempotencyKey: `old-${label}`, commandFingerprint: "f".repeat(64), allocations: [],
    evidenceId: evidence.id, occurredAt: new Date("2026-10-01T00:00:00.000Z"), confirmedBy: actors.accountant.id,
  } });
  await client.settlementCashAllocation.create({ data: {
    projectId: project.id, obligationId: original.id, recipientKey: original.recipientKey, cashId: oldCash.id,
    amount: "1000", idempotencyKey: `old-${label}`, commandFingerprint: "f".repeat(64),
  } });
  const oldSnapshot = await client.workflowApprovedSnapshot.create({ data: {
    requestId: request.id, version: request.version, mode: "DIGITAL", evidenceState: "DIGITAL_CONFIRMED", projection: { old: true },
    projectionSha256: "1".repeat(64), attestationKeyId: "old-key", attestation: "old-attestation",
  } });
  return { actors, project, request, dossier, version, original, oldCash, oldSnapshot };
}

function cashForm(versionId, obligation, amount, key) {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    settlementObligationId: obligation.id,
    dossierVersionId: versionId,
    recipientKey: obligation.recipientKey,
    direction: obligation.direction === "REFUND" ? "IN" : "OUT",
    amount,
    idempotencyKey: key,
    channel: "BANK_TRANSFER",
    reference: key,
    occurredAt: "2026-10-12T08:00:00.000Z",
  })) form.set(name, value);
  return form;
}

const proof = label => ({ name: `${label}.pdf`, mimeType: "application/pdf", size: label.length, data: Buffer.from(label) });

test("scoped reopen keeps one open lifecycle and appends an immutable correction version", async () => {
  await withMigratedSchema(async ({ client, correction }) => {
    const fx = await fixture(client, "scope");
    const before = {
      cash: await client.costFlowCash.findMany({ where: { projectId: fx.project.id }, orderBy: { id: "asc" } }),
      allocations: await client.settlementCashAllocation.findMany({ where: { projectId: fx.project.id }, orderBy: { id: "asc" } }),
      locks: await client.settlementLock.findMany({ where: { projectId: fx.project.id }, orderBy: { id: "asc" } }),
      snapshots: await client.workflowApprovedSnapshot.findMany({ where: { requestId: fx.request.id }, orderBy: { id: "asc" } }),
    };
    const requestInput = {
      projectId: fx.project.id, dossierId: fx.dossier.id, baseVersionId: fx.version.id,
      requestedById: fx.actors.owner.id, reason: "Sửa đúng người nhận",
      capabilities: ["CORRECT_RECIPIENT", "RECOVER_CASH"], obligationIds: [fx.original.id],
    };
    const attempt = await client.$transaction(tx => correction.requestSettlementCorrection(tx, requestInput));
    await assert.rejects(
      () => client.$transaction(tx => correction.requestSettlementCorrection(tx, requestInput)),
      /đang mở|đã tồn tại|unique/i,
    );
    await assert.rejects(
      () => client.$transaction(tx => correction.approveSettlementCorrection(tx, { projectId: fx.project.id, attemptId: attempt.id, actorId: fx.actors.unrelatedManager.id })),
      /Manager|phân công/i,
    );
    await client.$transaction(tx => correction.approveSettlementCorrection(tx, { projectId: fx.project.id, attemptId: attempt.id, actorId: fx.actors.manager.id }));
    const created = await client.$transaction(tx => correction.createSettlementCorrectionVersion(tx, {
      projectId: fx.project.id, attemptId: attempt.id, actorId: fx.actors.owner.id,
      obligationId: fx.original.id, correctedRecipientKey: `USER:${fx.actors.correct.id}`,
    }));
    await assert.rejects(
      () => client.$transaction(tx => correction.createSettlementCorrectionVersion(tx, {
        projectId: fx.project.id, attemptId: attempt.id, actorId: fx.actors.owner.id,
        obligationId: fx.original.id, correctedRecipientKey: `USER:${fx.actors.correct.id}`,
      })),
      /đã tạo|replay|stage/i,
    );
    assert.equal(created.dossierId, fx.dossier.id);
    assert.notEqual(created.requestId, fx.request.id);
    assert.notEqual(created.approvalAttemptId, fx.request.currentAttemptId);
    assert.deepEqual(created.steps.map(step => step.role), ["MANAGER", "ACCOUNTANT", "CEO"]);
    const pair = await client.settlementCorrectionObligationPair.findFirstOrThrow({ where: { correctionAttemptId: attempt.id }, include: { recoveryObligation: true, correctedPaymentObligation: true } });
    assert.equal(pair.recoveryObligation.recipientKey, fx.original.recipientKey);
    assert.equal(pair.correctedPaymentObligation.recipientKey, `USER:${fx.actors.correct.id}`);
    assert.equal(pair.recoveryObligation.amountDue, "1000");
    assert.equal(pair.correctedPaymentObligation.amountDue, "1000");
    assert.deepEqual(await client.costFlowCash.findMany({ where: { projectId: fx.project.id }, orderBy: { id: "asc" } }), before.cash);
    assert.deepEqual(await client.settlementCashAllocation.findMany({ where: { projectId: fx.project.id, obligationId: fx.original.id }, orderBy: { id: "asc" } }), before.allocations);
    assert.deepEqual(await client.settlementLock.findMany({ where: { projectId: fx.project.id, dossierVersionId: fx.version.id }, orderBy: { id: "asc" } }), before.locks);
    assert.deepEqual(await client.workflowApprovedSnapshot.findMany({ where: { requestId: fx.request.id }, orderBy: { id: "asc" } }), before.snapshots);
  });
});

test("recovery gates corrected OUT through partial, replay, foreign-pair and concurrent paths", async () => {
  await withMigratedSchema(async ({ client, correction, cash, readModel }) => {
    const fx = await fixture(client, "cash");
    const foreign = await fixture(client, "foreign");
    const attempt = await client.$transaction(tx => correction.requestSettlementCorrection(tx, {
      projectId: fx.project.id, dossierId: fx.dossier.id, baseVersionId: fx.version.id, requestedById: fx.actors.owner.id,
      reason: "Recover then repay", capabilities: ["CORRECT_RECIPIENT", "RECOVER_CASH"], obligationIds: [fx.original.id],
    }));
    await client.$transaction(tx => correction.approveSettlementCorrection(tx, { projectId: fx.project.id, attemptId: attempt.id, actorId: fx.actors.manager.id }));
    const created = await client.$transaction(tx => correction.createSettlementCorrectionVersion(tx, {
      projectId: fx.project.id, attemptId: attempt.id, actorId: fx.actors.owner.id, obligationId: fx.original.id,
      correctedRecipientKey: `USER:${fx.actors.correct.id}`,
    }));
    const pair = await client.settlementCorrectionObligationPair.findFirstOrThrow({ where: { correctionAttemptId: attempt.id }, include: { recoveryObligation: true, correctedPaymentObligation: true } });

    await assert.rejects(
      () => cash.executeSettlementCash(fx.project.id, fx.actors.accountant, cashForm(created.versionId, pair.correctedPaymentObligation, "1000", "premature"), proof("premature")),
      /recovery|thu hồi|phê duyệt/i,
    );
    const first = await cash.executeSettlementCash(fx.project.id, fx.actors.accountant, cashForm(created.versionId, pair.recoveryObligation, "400", "recovery-1"), proof("recovery-400"));
    const replay = await cash.executeSettlementCash(fx.project.id, fx.actors.accountant, cashForm(created.versionId, pair.recoveryObligation, "400", "recovery-1"), proof("recovery-400"));
    assert.equal(first.idempotent, false);
    assert.equal(replay.idempotent, true);
    const projection = readModel.projectSettlementCorrectionProgress({
      obligations: [
        { projectId: fx.project.id, dossierId: fx.dossier.id, dossierVersionId: created.versionId, requestId: created.requestId, obligationId: pair.recoveryObligation.id, recipientKey: pair.recoveryObligation.recipientKey, recipientType: "EMPLOYEE", recipientName: "Wrong", bankName: null, accountLast4: null, direction: "IN", amountDue: "1000", locked: true, sourceKind: "SETTLEMENT" },
        { projectId: fx.project.id, dossierId: fx.dossier.id, dossierVersionId: created.versionId, requestId: created.requestId, obligationId: pair.correctedPaymentObligation.id, recipientKey: pair.correctedPaymentObligation.recipientKey, recipientType: "EMPLOYEE", recipientName: "Correct", bankName: null, accountLast4: null, direction: "OUT", amountDue: "1000", locked: true, sourceKind: "SETTLEMENT" },
      ],
      allocations: [{ projectId: fx.project.id, dossierVersionId: created.versionId, obligationId: pair.recoveryObligation.id, recipientKey: pair.recoveryObligation.recipientKey, direction: "IN", amount: "400", cashId: first.cashId, idempotencyKey: "recovery-1", commandFingerprint: "x", evidenceId: "x" }],
      pairs: [{ projectId: fx.project.id, correctionAttemptId: attempt.id, recoveryObligationId: pair.recoveryObligation.id, correctedPaymentObligationId: pair.correctedPaymentObligation.id }],
    });
    assert.equal(projection.find(row => row.obligationId === pair.correctedPaymentObligation.id).availability, "BLOCKED_RECOVERY");
    assert.equal(projection.find(row => row.obligationId === pair.correctedPaymentObligation.id).recoveryRemaining, "600");

    await assert.rejects(
      () => cash.executeSettlementCash(foreign.project.id, foreign.actors.accountant, cashForm(created.versionId, pair.recoveryObligation, "1", "foreign-pair"), proof("foreign-pair")),
      /Project|hồ sơ/i,
    );
    const race = await Promise.allSettled([
      cash.executeSettlementCash(fx.project.id, fx.actors.accountant, cashForm(created.versionId, pair.recoveryObligation, "600", "recovery-2"), proof("recovery-600")),
      cash.executeSettlementCash(fx.project.id, fx.actors.accountant, cashForm(created.versionId, pair.correctedPaymentObligation, "1000", "race-out"), proof("race-out")),
    ]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.match(String(race.find(result => result.status === "rejected")?.reason), /recovery|thu hồi|phê duyệt/i);

    const freshRequest = await client.workflowRequest.findUniqueOrThrow({ where: { id: created.requestId } });
    await client.workflowRequest.update({ where: { id: created.requestId }, data: { state: "APPROVED" } });
    await client.settlementCorrectionAttempt.update({ where: { id: attempt.id }, data: { stage: "PAYMENT_PENDING" } });
    await cash.executeSettlementCash(fx.project.id, fx.actors.accountant, cashForm(created.versionId, pair.correctedPaymentObligation, "1000", "corrected-out"), proof("corrected-out"));
    await assert.rejects(
      () => client.$transaction(tx => correction.refreshSettlementCorrectionLifecycle(tx, { projectId: fx.project.id, attemptId: attempt.id })),
      /ký|snapshot/i,
    );
    assert.ok(fx.oldSnapshot.id, "old snapshot exists but must not authorize the correction");
    await client.workflowApprovedSnapshot.create({ data: {
      requestId: created.requestId, version: freshRequest.version, mode: "DIGITAL", evidenceState: "DIGITAL_CONFIRMED", projection: { corrected: true },
      projectionSha256: "2".repeat(64), attestationKeyId: "new-key", attestation: "new-attestation",
    } });
    const completed = await client.$transaction(tx => correction.refreshSettlementCorrectionLifecycle(tx, { projectId: fx.project.id, attemptId: attempt.id }));
    assert.equal(completed.stage, "COMPLETED");
    assert.ok(completed.terminalAt);
  });
});
