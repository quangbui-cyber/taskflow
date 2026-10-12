import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const PINNED_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withMigratedSchema(run) {
  const schemaName = `phase10_cash_${randomUUID().replaceAll("-", "")}`;
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
    const cash = await import(`../lib/costflow/settlementCash.ts?schema=${schemaName}`);
    const service = await import(`../lib/costflow/service.ts?schema=${schemaName}`);
    await run({ client, cash, service });
  } finally {
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
}

const financeData = (accountantId, managerId, ceoId) => ({
  config: { accountantId, managerId, ceoId, operationUserIds: [] },
  closed: false,
  revisions: [],
  beneficiaries: [],
  expenses: [],
  pos: [],
  quotations: [],
  briefs: [],
  vendorPaymentMilestones: [],
});

async function createUser(client, label, role = "USER", isActive = true) {
  const id = `${label}-${randomUUID()}`;
  return client.user.create({ data: { id, email: `${id}@example.test`, name: label, passwordHash: "test", role, isActive } });
}

async function createLockedSource(client, { projectId, ownerId, accountantId, recipientKey, obligationId, dossierVersionId, label }) {
  const request = await client.workflowRequest.create({ data: {
    projectId,
    module: "COSTFLOW",
    kind: "ADVANCE",
    title: `Advance ${label}`,
    creatorId: ownerId,
    cashAssigneeId: accountantId,
    state: "APPROVED",
    steps: [],
    payload: {},
  } });
  await client.paymentRecipientSnapshot.create({ data: { projectId, requestId: request.id, recipientKey, recipientType: "EMPLOYEE", displayName: label, totalAmount: "1000" } });
  const line = await client.paymentRequestLine.create({ data: {
    projectId,
    requestId: request.id,
    stableKey: `line-${label}`,
    position: 0,
    description: label,
    amount: "1000",
    icRevisionId: `ic-${label}`,
    icLineId: `ic-line-${label}`,
    sourceSnapshot: {},
    recipientKey,
    evidenceManifest: [],
  } });
  const application = await client.advanceApplication.create({ data: { projectId, advanceRequestId: request.id, advanceLineId: line.id, expenseId: `expense-${label}`, recipientKey, amount: "1000", createdBy: ownerId } });
  const sourceCash = await client.costFlowCash.create({ data: {
    projectId,
    requestId: request.id,
    recipientKey,
    direction: "OUT",
    channel: "BANK_TRANSFER",
    amount: "1000",
    reference: `SRC-${label}`,
    idempotencyKey: `src-${label}`,
    commandFingerprint: `source-${label}`,
    allocations: [],
    evidenceId: `source-evidence-${label}`,
    occurredAt: new Date("2026-10-01T00:00:00.000Z"),
    confirmedBy: accountantId,
  } });
  const sourceAllocation = await client.costFlowCashAllocation.create({ data: { projectId, cashId: sourceCash.id, requestId: request.id, requestLineId: line.id, recipientKey, direction: "OUT", amount: "1000" } });
  await client.settlementLock.create({ data: { projectId, dossierVersionId, obligationId, recipientKey, advanceApplicationId: application.id, sourceCashAllocationId: sourceAllocation.id } });
}

async function createProjectFixture(client, actors, label) {
  const project = await client.project.create({ data: {
    name: `Cash authority ${label}`,
    ownerId: actors.owner.id,
    members: { create: [actors.owner, actors.accountant, actors.cashAssignee, actors.beneficiary].map(user => ({ userId: user.id })) },
  } });
  await client.costFlowWorkspace.create({ data: { projectId: project.id, data: financeData(actors.accountant.id, actors.manager.id, actors.ceo.id) } });
  const request = await client.workflowRequest.create({ data: {
    projectId: project.id,
    module: "COSTFLOW",
    kind: "SETTLEMENT",
    title: `Settlement ${label}`,
    creatorId: actors.owner.id,
    cashAssigneeId: actors.cashAssignee.id,
    state: "APPROVED",
    steps: [],
    payload: {},
  } });
  const dossier = await client.projectSettlementDossier.create({ data: { projectId: project.id, createdById: actors.owner.id } });
  const version = await client.projectSettlementVersion.create({ data: { projectId: project.id, dossierId: dossier.id, requestId: request.id, version: 1, attemptId: `attempt-${label}`, canonicalHash: "a".repeat(64), createdById: actors.owner.id } });
  const refund = await client.settlementRecipientObligation.create({ data: { projectId: project.id, dossierVersionId: version.id, recipientKey: `USER:${actors.owner.id}`, recipientType: "EMPLOYEE", direction: "REFUND", approvedAcGross: "0", disbursedAdvance: "1000", amountDue: "1000" } });
  const additional = await client.settlementRecipientObligation.create({ data: { projectId: project.id, dossierVersionId: version.id, recipientKey: `USER:${actors.beneficiary.id}`, recipientType: "EMPLOYEE", direction: "ADDITIONAL", approvedAcGross: "2000", disbursedAdvance: "1000", amountDue: "1000" } });
  await createLockedSource(client, { projectId: project.id, ownerId: actors.owner.id, accountantId: actors.accountant.id, recipientKey: refund.recipientKey, obligationId: refund.id, dossierVersionId: version.id, label: `refund-${label}` });
  await createLockedSource(client, { projectId: project.id, ownerId: actors.owner.id, accountantId: actors.accountant.id, recipientKey: additional.recipientKey, obligationId: additional.id, dossierVersionId: version.id, label: `additional-${label}` });
  return { project, request, dossier, version, refund, additional };
}

function cashForm(fixture, obligation, overrides = {}) {
  const direction = obligation.direction === "REFUND" ? "IN" : "OUT";
  const form = new FormData();
  const values = {
    settlementObligationId: obligation.id,
    dossierVersionId: fixture.version.id,
    recipientKey: obligation.recipientKey,
    direction,
    amount: "400",
    idempotencyKey: `${obligation.id}-cash-1`,
    channel: "BANK_TRANSFER",
    reference: `${direction}-${obligation.id}-1`,
    occurredAt: "2026-10-12T08:00:00.000Z",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

const proof = label => ({ name: `${label}.pdf`, mimeType: "application/pdf", size: label.length, data: Buffer.from(label) });

function progressById(finance, obligationId) {
  return finance.settlementObligationProgress.find(row => row.obligationId === obligationId);
}

test("settlement cash enforces project authority and exposes private-safe IN/OUT progress", async () => {
  await withMigratedSchema(async ({ client, cash, service }) => {
    const actors = {
      owner: await createUser(client, "owner", "ACCOUNT"),
      manager: await createUser(client, "manager"),
      accountant: await createUser(client, "accountant", "ACCOUNT"),
      cashAssignee: await createUser(client, "cash-assignee", "ACCOUNT"),
      beneficiary: await createUser(client, "beneficiary"),
      unrelated: await createUser(client, "unrelated", "ACCOUNT"),
      inactive: await createUser(client, "inactive", "ACCOUNT", false),
      admin: await createUser(client, "admin", "ADMIN"),
      ceo: await createUser(client, "ceo"),
    };
    const fixture = await createProjectFixture(client, actors, "primary");
    const foreign = await createProjectFixture(client, actors, "foreign");
    await client.projectMember.create({ data: { projectId: fixture.project.id, userId: actors.inactive.id } });

    await assert.rejects(() => cash.executeSettlementCash(fixture.project.id, actors.unrelated, cashForm(fixture, fixture.refund), proof("unrelated")), /quyền|Project|phân công|Kế toán/i);
    await assert.rejects(() => cash.executeSettlementCash(fixture.project.id, actors.inactive, cashForm(fixture, fixture.refund), proof("inactive")), /hoạt động|quyền/i);

    const firstRefund = await cash.executeSettlementCash(fixture.project.id, actors.accountant, cashForm(fixture, fixture.refund), proof("refund-400"));
    assert.equal(firstRefund.idempotent, false);
    const refundReplay = await cash.executeSettlementCash(fixture.project.id, actors.accountant, cashForm(fixture, fixture.refund), proof("refund-400"));
    assert.equal(refundReplay.idempotent, true);
    await assert.rejects(() => cash.executeSettlementCash(fixture.project.id, actors.accountant, cashForm(fixture, fixture.refund, { amount: "300" }), proof("refund-400")), /mã chống ghi trùng/i);

    let workspace = await service.loadFinance(fixture.project.id, actors.accountant);
    assert.deepEqual(progressById(workspace, fixture.refund.id), {
      projectId: fixture.project.id,
      dossierVersionId: fixture.version.id,
      obligationId: fixture.refund.id,
      recipientKey: fixture.refund.recipientKey,
      direction: "IN",
      approvedAmount: "1000",
      cumulativeAmount: "400",
      remainingAmount: "600",
      cashProgress: "DANG_CHI_MOT_PHAN",
    });
    assert.equal("bankName" in progressById(workspace, fixture.refund.id), false);
    assert.equal("accountLast4" in progressById(workspace, fixture.refund.id), false);
    assert.equal(workspace.paymentLedger.some(row => row.obligationId === fixture.refund.id), false, "refund IN never enters the OUT-only disbursement queue");

    await cash.executeSettlementCash(fixture.project.id, actors.cashAssignee, cashForm(fixture, fixture.refund, { amount: "600", idempotencyKey: `${fixture.refund.id}-cash-2`, reference: "IN-refund-2" }), proof("refund-600"));
    workspace = await service.loadFinance(fixture.project.id, actors.cashAssignee);
    assert.equal(progressById(workspace, fixture.refund.id).remainingAmount, "0");
    await cash.executeSettlementCash(fixture.project.id, actors.admin, cashForm(fixture, fixture.additional, { amount: "300", idempotencyKey: `${fixture.additional.id}-cash-1`, reference: "OUT-additional-1" }), proof("additional-300"));
    workspace = await service.loadFinance(fixture.project.id, actors.admin);
    assert.equal(progressById(workspace, fixture.additional.id).remainingAmount, "700");
    await cash.executeSettlementCash(fixture.project.id, actors.cashAssignee, cashForm(fixture, fixture.additional, { amount: "700", idempotencyKey: `${fixture.additional.id}-cash-2`, reference: "OUT-additional-2" }), proof("additional-700"));

    workspace = await service.loadFinance(fixture.project.id, actors.accountant);
    assert.equal(progressById(workspace, fixture.refund.id).remainingAmount, "0");
    assert.equal(progressById(workspace, fixture.additional.id).remainingAmount, "0");
    assert.equal(workspace.paymentLedger.filter(row => row.provenance === "settlement").length, 0, "ordinary disbursement queue remains OUT-only and hides completed OUT rows");
    assert.equal(await client.costFlowCash.count({ where: { projectId: fixture.project.id, confirmedBy: actors.admin.id } }), 1, "ADMIN override remains auditable on the cash row");

    await assert.rejects(() => cash.executeSettlementCash(fixture.project.id, actors.accountant, cashForm(fixture, fixture.refund, { amount: "1", idempotencyKey: "after-zero", reference: "after-zero" }), proof("after-zero")), /vượt|còn lại/i);
    await assert.rejects(() => cash.executeSettlementCash(fixture.project.id, actors.accountant, cashForm(fixture, fixture.additional, { recipientKey: fixture.refund.recipientKey, idempotencyKey: "foreign-recipient", reference: "foreign-recipient" }), proof("foreign-recipient")), /người nhận/i);
    await assert.rejects(() => cash.executeSettlementCash(fixture.project.id, actors.accountant, cashForm(fixture, fixture.additional, { dossierVersionId: foreign.version.id, idempotencyKey: "foreign-version", reference: "foreign-version" }), proof("foreign-version")), /phiên bản|version/i);
    await assert.rejects(() => cash.executeSettlementCash(fixture.project.id, actors.accountant, cashForm(foreign, foreign.additional, { idempotencyKey: "foreign-project", reference: "foreign-project" }), proof("foreign-project")), /Project|hồ sơ/i);

    const raceActors = {
      owner: await createUser(client, "race-owner", "ACCOUNT"),
      manager: await createUser(client, "race-manager"),
      accountant: await createUser(client, "race-accountant", "ACCOUNT"),
      cashAssignee: await createUser(client, "race-cash", "ACCOUNT"),
      beneficiary: await createUser(client, "race-beneficiary"),
      ceo: await createUser(client, "race-ceo"),
    };
    const raceFixture = await createProjectFixture(client, raceActors, "race");
    const race = await Promise.allSettled([
      cash.executeSettlementCash(raceFixture.project.id, raceActors.accountant, cashForm(raceFixture, raceFixture.additional, { amount: "700", idempotencyKey: "race-a", reference: "race-a" }), proof("race-a")),
      cash.executeSettlementCash(raceFixture.project.id, raceActors.accountant, cashForm(raceFixture, raceFixture.additional, { amount: "700", idempotencyKey: "race-b", reference: "race-b" }), proof("race-b")),
    ]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1, race.map(result => result.status === "rejected" ? String(result.reason) : "fulfilled").join(" | "));
    const allocated = await client.settlementCashAllocation.findMany({ where: { obligationId: raceFixture.additional.id }, select: { amount: true } });
    assert.equal(allocated.reduce((total, row) => total + BigInt(row.amount), 0n), 700n);
  });
});
