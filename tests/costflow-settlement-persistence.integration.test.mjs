import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const PINNED_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function commandForm(command, projectId, version, requestId) {
  const form = new FormData();
  form.set("command", command);
  form.set("projectId", projectId);
  form.set("settlementVersion", String(version));
  if (requestId) form.set("requestId", requestId);
  return form;
}

async function withMigratedSettlementSchema(run) {
  const schemaName = `phase10_manifest_${randomUUID().replaceAll("-", "")}`;
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
    const service = await import(`../lib/costflow/settlementService.ts?schema=${schemaName}`);
    await run({ client, service });
  } finally {
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
}

async function createFixture(client, service, label, { completeEvidence = false, actualAmount = "800" } = {}) {
  const suffix = `${label}-${randomUUID()}`;
  const ids = {
    owner: `owner-${suffix}`,
    manager: `manager-${suffix}`,
    accountant: `accountant-${suffix}`,
    ceo: `ceo-${suffix}`,
    project: `project-${suffix}`,
    advanceRequest: `advance-request-${suffix}`,
    advanceLine: `advance-line-${suffix}`,
    distractorLine: `distractor-line-${suffix}`,
    advanceApplication: `advance-application-${suffix}`,
    distractorApplication: `distractor-application-${suffix}`,
    actualLine: `actual-line-${suffix}`,
    actualVersion: `actual-version-${suffix}`,
    actualApproval: `actual-approval-${suffix}`,
    acEvidence: `ac-evidence-${suffix}`,
    cashEvidenceOne: `cash-evidence-one-${suffix}`,
    cashEvidenceTwo: `cash-evidence-two-${suffix}`,
  };
  await client.user.createMany({ data: [
    { id: ids.manager, email: `${ids.manager}@example.test`, name: "Manager", passwordHash: "test", role: "USER" },
    { id: ids.accountant, email: `${ids.accountant}@example.test`, name: "Accountant", passwordHash: "test", role: "ACCOUNT" },
    { id: ids.ceo, email: `${ids.ceo}@example.test`, name: "CEO", passwordHash: "test", role: "USER" },
    { id: ids.owner, email: `${ids.owner}@example.test`, name: "Owner", passwordHash: "test", role: "ACCOUNT", managerId: ids.manager },
  ] });
  await client.project.create({ data: { id: ids.project, name: `Settlement ${label}`, ownerId: ids.owner } });
  await client.costFlowWorkspace.create({ data: {
    projectId: ids.project,
    data: { config: { accountantId: ids.accountant, ceoId: ids.ceo } },
  } });
  await client.workflowRequest.create({ data: {
    id: ids.advanceRequest,
    projectId: ids.project,
    module: "COSTFLOW",
    kind: "ADVANCE",
    title: "Advance source",
    creatorId: ids.owner,
    cashAssigneeId: ids.accountant,
    state: "APPROVED",
    steps: [],
    payload: {},
  } });
  const recipientKey = `USER:${ids.owner}`;
  await client.paymentRecipientSnapshot.create({ data: {
    projectId: ids.project,
    requestId: ids.advanceRequest,
    recipientKey,
    recipientType: "EMPLOYEE",
    displayName: "Owner",
    totalAmount: "1000",
  } });
  await client.paymentRequestLine.createMany({ data: [
    {
      id: ids.advanceLine,
      projectId: ids.project,
      requestId: ids.advanceRequest,
      stableKey: `advance-${suffix}`,
      position: 0,
      description: "Advance line",
      amount: "1000",
      icRevisionId: `ic-revision-${suffix}`,
      icLineId: `ic-line-${suffix}`,
      sourceSnapshot: {},
      recipientKey,
      evidenceManifest: [],
    },
    {
      id: ids.distractorLine,
      projectId: ids.project,
      requestId: ids.advanceRequest,
      stableKey: `distractor-${suffix}`,
      position: 1,
      description: "Unrelated advance line",
      amount: "50",
      icRevisionId: `ic-revision-other-${suffix}`,
      icLineId: `ic-line-other-${suffix}`,
      sourceSnapshot: {},
      recipientKey,
      evidenceManifest: [],
    },
  ] });
  await client.advanceApplication.createMany({ data: [
    {
      id: ids.advanceApplication,
      projectId: ids.project,
      advanceRequestId: ids.advanceRequest,
      advanceLineId: ids.advanceLine,
      expenseId: `expense-${suffix}`,
      recipientKey,
      amount: "1000",
      createdBy: ids.owner,
    },
    {
      id: ids.distractorApplication,
      projectId: ids.project,
      advanceRequestId: ids.advanceRequest,
      advanceLineId: ids.distractorLine,
      expenseId: `expense-other-${suffix}`,
      recipientKey,
      amount: "50",
      createdBy: ids.owner,
    },
  ] });

  if (completeEvidence) {
    await client.costFlowEvidence.createMany({ data: [
      { id: ids.acEvidence, projectId: ids.project, sourceFileId: `ac-${suffix}`, kind: "VAT_INVOICE", name: "invoice.pdf", mimeType: "application/pdf", data: Buffer.from("invoice"), sha256: "a".repeat(64), createdBy: ids.owner },
      { id: ids.cashEvidenceOne, projectId: ids.project, sourceFileId: `cash-1-${suffix}`, kind: "PAYMENT_PROOF", name: "cash-1.pdf", mimeType: "application/pdf", data: Buffer.from("cash-1"), sha256: "b".repeat(64), createdBy: ids.owner },
      { id: ids.cashEvidenceTwo, projectId: ids.project, sourceFileId: `cash-2-${suffix}`, kind: "PAYMENT_PROOF", name: "cash-2.pdf", mimeType: "application/pdf", data: Buffer.from("cash-2"), sha256: "c".repeat(64), createdBy: ids.owner },
    ] });
  }

  for (const [index, amount] of ["400", "600"].entries()) {
    const cashId = `cash-${index}-${suffix}`;
    const allocationId = `allocation-${index}-${suffix}`;
    const evidenceId = completeEvidence
      ? (index === 0 ? ids.cashEvidenceOne : ids.cashEvidenceTwo)
      : `missing-cash-evidence-${index}-${suffix}`;
    await client.costFlowCash.create({ data: {
      id: cashId,
      projectId: ids.project,
      requestId: ids.advanceRequest,
      recipientKey,
      direction: "OUT",
      channel: "BANK",
      amount,
      reference: `REF-${index}-${suffix}`,
      idempotencyKey: `cash-key-${index}-${suffix}`,
      commandFingerprint: `cash-fingerprint-${index}-${suffix}`,
      allocations: [],
      evidenceId,
      occurredAt: new Date("2026-10-01T00:00:00Z"),
      confirmedBy: ids.accountant,
    } });
    await client.costFlowCashAllocation.create({ data: {
      id: allocationId,
      projectId: ids.project,
      cashId,
      requestId: ids.advanceRequest,
      requestLineId: ids.advanceLine,
      recipientKey,
      direction: "OUT",
      amount,
    } });
  }

  await client.actualCostLine.create({ data: {
    id: ids.actualLine,
    projectId: ids.project,
    stableLineId: `ac-${suffix}`,
    icRevisionId: completeEvidence ? `ic-revision-${suffix}` : null,
    icLineId: completeEvidence ? `ic-line-${suffix}` : null,
    recipientKey,
    createdById: ids.owner,
    currentVersion: 1,
  } });
  await client.actualCostVersion.create({ data: {
    id: ids.actualVersion,
    projectId: ids.project,
    lineId: ids.actualLine,
    version: 1,
    state: "APPROVED",
    description: "Approved AC",
    fundingSource: "EMPLOYEE_ADVANCE",
    quantity: "1",
    days: "1",
    unitPrice: actualAmount,
    unit: "item",
    basis: "GROSS",
    vatPercent: "0",
    amount: actualAmount,
    rawAmount: actualAmount,
    createdById: ids.owner,
  } });
  await client.actualCostApproval.create({ data: {
    id: ids.actualApproval,
    projectId: ids.project,
    lineId: ids.actualLine,
    versionId: ids.actualVersion,
    attemptId: `ac-attempt-${suffix}`,
    retryKey: `ac-retry-${suffix}`,
    action: "APPROVED",
    actorId: ids.accountant,
  } });
  if (completeEvidence) {
    await client.actualCostEvidenceLink.create({ data: {
      projectId: ids.project,
      versionId: ids.actualVersion,
      evidenceId: ids.acEvidence,
      kind: "VAT_INVOICE",
      actorId: ids.accountant,
    } });
  }

  const create = commandForm("CREATE_SETTLEMENT_DOSSIER", ids.project, 0);
  const created = await service.executeSettlementCommand({ id: ids.owner, role: "ACCOUNT" }, create, null);
  const request = await client.workflowRequest.findUniqueOrThrow({ where: { id: created.requestId } });
  const version = await client.projectSettlementVersion.findFirstOrThrow({ where: { requestId: request.id } });
  return { ids, recipientKey, request, version };
}

function evidenceUpload(name) {
  const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  return { name, mimeType: "application/pdf", size: data.byteLength, data };
}

async function addEvidence(service, fixture, version, kind) {
  const form = commandForm("ADD_SETTLEMENT_EVIDENCE", fixture.ids.project, version, fixture.request.id);
  form.set("recipientKey", fixture.recipientKey);
  form.set("evidenceKind", kind);
  return service.executeSettlementCommand(
    { id: fixture.ids.owner, role: "ACCOUNT" },
    form,
    evidenceUpload(`${kind.toLowerCase()}.pdf`),
  );
}

async function submit(service, fixture, version) {
  return service.executeSettlementCommand(
    { id: fixture.ids.owner, role: "ACCOUNT" },
    commandForm("SUBMIT_SETTLEMENT_DOSSIER", fixture.ids.project, version, fixture.request.id),
    null,
  );
}

test("persisted settlement manifest classifies evidence, keeps every installment, and rejects drift", { timeout: 180_000 }, async () => {
  await withMigratedSettlementSchema(async ({ client, service }) => {
    const fixture = await createFixture(client, service, "supplemental");
    const payload = fixture.request.payload.settlement;
    assert.equal(payload.sourceManifest.advanceAllocations.length, 2, "both cash OUT installments must be in the canonical manifest");
    assert.deepEqual(
      payload.sourceManifest.advanceAllocations.map(item => item.amount).sort(),
      ["400", "600"],
      "the canonical manifest must preserve every installment amount",
    );
    const manifestRows = await client.settlementAdvanceManifestRow.findMany({
      where: { dossierVersionId: fixture.version.id },
      include: { sourceCashAllocation: true },
      orderBy: { sourceCashAllocationId: "asc" },
    });
    assert.equal(manifestRows.length, 2);
    assert.ok(manifestRows.every(row => row.advanceApplicationId === fixture.ids.advanceApplication));
    assert.deepEqual(manifestRows.map(row => row.sourceCashAllocation.amount).sort(), ["400", "600"]);
    assert.ok(manifestRows.every(row => row.advanceApplicationId !== fixture.ids.distractorApplication));

    let requestVersion = 0;
    for (const [kind, clearedCode, remainingCodes] of [
      ["RELATED_IC_AC", "MISSING_RELATED_IC_AC", ["MISSING_EXPENSE_EVIDENCE", "MISSING_DISBURSEMENT_PROOF"]],
      ["VAT_INVOICE", "MISSING_EXPENSE_EVIDENCE", ["MISSING_DISBURSEMENT_PROOF"]],
      ["PAYMENT_PROOF", "MISSING_DISBURSEMENT_PROOF", []],
    ]) {
      const uploaded = await addEvidence(service, fixture, requestVersion, kind);
      requestVersion = uploaded.settlementVersion;
      if (kind !== "PAYMENT_PROOF") {
        await assert.rejects(
          () => submit(service, fixture, requestVersion),
          error => {
            assert.ok(!error.codes.includes(clearedCode), `${kind} should clear only ${clearedCode}`);
            assert.deepEqual(error.codes, remainingCodes);
            return true;
          },
        );
      }
    }
    const submitted = await submit(service, fixture, requestVersion);
    assert.equal(submitted.settlementVersion, requestVersion + 1);
    const submittedRequest = await client.workflowRequest.findUniqueOrThrow({ where: { id: fixture.request.id } });
    assert.equal(submittedRequest.state, "SUBMITTED");
    assert.equal(await client.costFlowCash.count({ where: { projectId: fixture.ids.project } }), 2, "dossier lifecycle must be cash-neutral");

    const additional = await createFixture(client, service, "additional", { completeEvidence: true, actualAmount: "1200" });
    const additionalObligation = await client.settlementRecipientObligation.findFirstOrThrow({ where: { dossierVersionId: additional.version.id } });
    assert.equal(additionalObligation.direction, "ADDITIONAL");
    assert.equal(additionalObligation.amountDue, "200");
    await submit(service, additional, 0);

    const driftCases = [
      {
        name: "source amount",
        mutate: async current => client.actualCostVersion.update({ where: { id: current.ids.actualVersion }, data: { amount: "801", rawAmount: "801" } }),
      },
      {
        name: "recipient",
        mutate: async current => client.actualCostApplication.updateMany({ where: { requestId: current.request.id }, data: { recipientKey: `USER:changed-${current.ids.owner}` } }),
      },
      {
        name: "evidence hash",
        mutate: async current => client.costFlowEvidence.update({ where: { id: current.ids.acEvidence }, data: { sha256: "f".repeat(64) } }),
      },
      {
        name: "stored projection hash",
        mutate: async current => {
          const stored = await client.workflowRequest.findUniqueOrThrow({ where: { id: current.request.id } });
          const changed = structuredClone(stored.payload);
          changed.settlement.projectionHash = "0".repeat(64);
          await client.workflowRequest.update({ where: { id: current.request.id }, data: { payload: changed } });
        },
      },
    ];
    for (const driftCase of driftCases) {
      const current = await createFixture(client, service, `drift-${driftCase.name}`, { completeEvidence: true });
      const before = {
        request: await client.workflowRequest.findUniqueOrThrow({ where: { id: current.request.id } }),
        events: await client.workflowApprovalEvent.count({ where: { requestId: current.request.id } }),
        cash: await client.costFlowCash.count({ where: { projectId: current.ids.project } }),
      };
      await driftCase.mutate(current);
      await assert.rejects(() => submit(service, current, 0), /hash|nguồn|projection|snapshot|thay đổi|tamper/i, driftCase.name);
      const after = await client.workflowRequest.findUniqueOrThrow({ where: { id: current.request.id } });
      assert.equal(after.version, before.request.version, `${driftCase.name} must not advance request version`);
      assert.equal(after.state, "DRAFT", `${driftCase.name} must not submit the dossier`);
      assert.equal(await client.workflowApprovalEvent.count({ where: { requestId: current.request.id } }), before.events);
      assert.equal(await client.costFlowCash.count({ where: { projectId: current.ids.project } }), before.cash);
    }

    const cancellable = await createFixture(client, service, "cancel", { completeEvidence: true });
    const cancel = commandForm("CANCEL_SETTLEMENT_DOSSIER", cancellable.ids.project, 0, cancellable.request.id);
    cancel.set("reason", "Dừng hồ sơ");
    await service.executeSettlementCommand({ id: cancellable.ids.manager, role: "USER" }, cancel, null);
    const eventsAfterFirstCancel = await client.workflowApprovalEvent.count({ where: { requestId: cancellable.request.id } });
    const repeat = commandForm("CANCEL_SETTLEMENT_DOSSIER", cancellable.ids.project, 1, cancellable.request.id);
    repeat.set("reason", "Dừng lần nữa");
    await assert.rejects(
      () => service.executeSettlementCommand({ id: cancellable.ids.manager, role: "USER" }, repeat, null),
      /cancelled|đã hủy|trạng thái/i,
    );
    assert.equal(await client.workflowApprovalEvent.count({ where: { requestId: cancellable.request.id } }), eventsAfterFirstCancel);
  });
});
