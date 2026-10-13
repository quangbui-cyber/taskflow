import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const PINNED_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/costflow_test";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = value => createHash("sha256").update(value).digest("hex");
const canonicalSha = value => {
  const stable = input => {
    if (Array.isArray(input)) return input.map(stable).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
    return input;
  };
  return sha(JSON.stringify(stable(value)));
};

async function withMigratedSchema(run) {
  const schemaName = `phase10_close_${randomUUID().replaceAll("-", "")}`;
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
    const service = await import(`../lib/costflow/service.ts?schema=${schemaName}`);
    await run({ client, service });
  } finally {
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
}

async function createUser(client, label, role = "USER") {
  const id = `${label}-${randomUUID()}`;
  return client.user.create({ data: { id, email: `${id}@example.test`, name: label, passwordHash: "test", role } });
}

const financeData = (accountantId, managerId, ceoId, closed = false) => ({
  config: { accountantId, managerId, ceoId, operationUserIds: [] },
  closed,
  revisions: [], beneficiaries: [], expenses: [], pos: [], quotations: [], briefs: [], vendorPaymentMilestones: [],
});

async function fixture(client, label) {
  const actors = {
    owner: await createUser(client, `${label}-owner`, "ACCOUNT"),
    manager: await createUser(client, `${label}-manager`),
    accountant: await createUser(client, `${label}-accountant`, "ACCOUNT"),
    ceo: await createUser(client, `${label}-ceo`),
    recipient: await createUser(client, `${label}-recipient`),
  };
  const project = await client.project.create({ data: {
    name: `Close ${label}`,
    ownerId: actors.owner.id,
    members: { create: Object.values(actors).map(actor => ({ userId: actor.id })) },
  } });
  await client.costFlowWorkspace.create({ data: { projectId: project.id, data: financeData(actors.accountant.id, actors.manager.id, actors.ceo.id) } });

  const advanceRequest = await client.workflowRequest.create({ data: {
    projectId: project.id, module: "COSTFLOW", kind: "ADVANCE", title: `Advance ${label}`,
    creatorId: actors.owner.id, cashAssigneeId: actors.accountant.id, state: "APPROVED", steps: [], payload: {},
  } });
  const recipientKey = `USER:${actors.recipient.id}`;
  await client.paymentRecipientSnapshot.create({ data: {
    projectId: project.id, requestId: advanceRequest.id, recipientKey,
    recipientType: "EMPLOYEE", displayName: actors.recipient.name, totalAmount: "1025",
  } });
  const line = await client.paymentRequestLine.create({ data: {
    projectId: project.id, requestId: advanceRequest.id, stableKey: `line-${label}`, position: 0,
    description: "Exact advance source", amount: "1000", icRevisionId: `ic-${label}`, icLineId: `ic-line-${label}`,
    sourceSnapshot: {}, recipientKey, evidenceManifest: [],
  } });
  const advance = await client.advanceApplication.create({ data: {
    projectId: project.id, advanceRequestId: advanceRequest.id, advanceLineId: line.id,
    expenseId: `expense-${label}`, recipientKey, amount: "1000", createdBy: actors.owner.id,
  } });
  const sourceCash = await client.costFlowCash.create({ data: {
    projectId: project.id, requestId: advanceRequest.id, recipientKey, direction: "OUT", channel: "BANK_TRANSFER",
    amount: "1000", reference: `ADV-${label}`, idempotencyKey: `adv-${label}`, commandFingerprint: sha(`adv-${label}`),
    allocations: [], evidenceId: `advance-proof-${label}`, occurredAt: new Date("2026-10-01T00:00:00.000Z"), confirmedBy: actors.accountant.id,
  } });
  const sourceAllocation = await client.costFlowCashAllocation.create({ data: {
    projectId: project.id, cashId: sourceCash.id, requestId: advanceRequest.id, requestLineId: line.id,
    recipientKey, direction: "OUT", amount: "1000",
  } });

  const sourceManifest = {
    actualCosts: [],
    advanceAllocations: [{
      projectId: project.id, applicationId: advance.id, cashAllocationId: sourceAllocation.id,
      recipientKey, amount: "1000",
    }],
  };
  const canonicalHash = sha(`settlement-${label}`);
  const settlementRequest = await client.workflowRequest.create({ data: {
    projectId: project.id, module: "COSTFLOW", kind: "SETTLEMENT", title: `Settlement ${label}`,
    creatorId: actors.owner.id, cashAssigneeId: actors.accountant.id, state: "APPROVED", version: 4,
    currentAttemptId: `attempt-${label}`,
    steps: [{ role: "MANAGER", assigneeId: actors.manager.id }, { role: "ACCOUNTANT", assigneeId: actors.accountant.id }, { role: "CEO", assigneeId: actors.ceo.id }],
    payload: { settlement: { sourceManifest, projectionHash: canonicalHash } },
  } });
  const dossier = await client.projectSettlementDossier.create({ data: { projectId: project.id, createdById: actors.owner.id } });
  const version = await client.projectSettlementVersion.create({ data: {
    projectId: project.id, dossierId: dossier.id, requestId: settlementRequest.id, version: 1,
    attemptId: `attempt-${label}`, canonicalHash, sourceManifestHash: canonicalSha(sourceManifest), createdById: actors.owner.id,
  } });
  const obligation = await client.settlementRecipientObligation.create({ data: {
    projectId: project.id, dossierVersionId: version.id, recipientKey, recipientType: "EMPLOYEE",
    direction: "ADDITIONAL", approvedAcGross: "1000", disbursedAdvance: "0", amountDue: "1000",
  } });
  const lock = await client.settlementLock.create({ data: {
    projectId: project.id, dossierVersionId: version.id, obligationId: obligation.id, recipientKey,
    advanceApplicationId: advance.id, sourceCashAllocationId: sourceAllocation.id,
  } });
  await client.settlementAdvanceManifestRow.create({ data: {
    projectId: project.id, dossierVersionId: version.id, obligationId: obligation.id, recipientKey,
    advanceApplicationId: advance.id, sourceCashAllocationId: sourceAllocation.id,
  } });

  const proof = await client.costFlowEvidence.create({ data: {
    projectId: project.id, requestId: settlementRequest.id, sourceFileId: `settlement-proof-${label}`,
    kind: "PAYMENT_PROOF", name: "payment.pdf", mimeType: "application/pdf", data: Buffer.from("payment"),
    sha256: sha("payment"), createdBy: actors.accountant.id,
  } });
  const settlementCash = await client.costFlowCash.create({ data: {
    projectId: project.id, requestId: settlementRequest.id, recipientKey, direction: "OUT", channel: "BANK_TRANSFER",
    amount: "1000", reference: `SET-${label}`, idempotencyKey: `set-${label}`, commandFingerprint: sha(`set-${label}`),
    allocations: [], evidenceId: proof.id, occurredAt: new Date("2026-10-02T00:00:00.000Z"), confirmedBy: actors.accountant.id,
  } });
  await client.settlementCashAllocation.create({ data: {
    projectId: project.id, obligationId: obligation.id, recipientKey, cashId: settlementCash.id,
    amount: "1000", idempotencyKey: `settlement-${label}`, commandFingerprint: sha(`settlement-${label}`),
  } });

  const liquidationProof = await client.costFlowEvidence.create({ data: {
    projectId: project.id, sourceFileId: `liquidation-${label}`, kind: "CUSTOMER_LIQUIDATION", name: "liquidation.pdf",
    mimeType: "application/pdf", data: Buffer.from("liquidation"), sha256: sha("liquidation"), createdBy: actors.owner.id,
  } });
  const liquidation = await client.customerLiquidation.create({ data: {
    projectId: project.id, version: 1, documentNumber: `TL-${label}`, signedAt: new Date("2026-10-03T00:00:00.000Z"),
    netAmount: "1000", vatAmount: "0", grossAmount: "1000", evidenceId: liquidationProof.id,
    sourceSnapshot: {}, createdById: actors.owner.id,
  } });
  await client.customerCashIn.create({ data: {
    projectId: project.id, liquidationId: liquidation.id, milestone: "FULL", occurredAt: new Date("2026-10-04T00:00:00.000Z"),
    amount: "1000", reference: `AR-${label}`, idempotencyKey: `ar-${label}`, commandFingerprint: sha(`ar-${label}`),
    evidenceId: liquidationProof.id, createdById: actors.accountant.id,
  } });

  // An unrelated Phase 7/8 application in the same Project must not become part of this version's close manifest.
  const unrelatedLine = await client.paymentRequestLine.create({ data: {
    projectId: project.id, requestId: advanceRequest.id, stableKey: `unrelated-${label}`, position: 1,
    description: "Unrelated source", amount: "25", icRevisionId: `ic-${label}`, icLineId: `other-${label}`,
    sourceSnapshot: {}, recipientKey, evidenceManifest: [],
  } });
  const unrelatedAdvance = await client.advanceApplication.create({ data: {
    projectId: project.id, advanceRequestId: advanceRequest.id, advanceLineId: unrelatedLine.id,
    expenseId: `unrelated-expense-${label}`, recipientKey, amount: "25", createdBy: actors.owner.id,
  } });
  return { actors, project, dossier, version, settlementRequest, obligation, lock, advance, sourceAllocation, unrelatedAdvance, canonicalHash, settlementCash, liquidation };
}

function closeForm(reason = "Đối soát hoàn tất") {
  const form = new FormData();
  form.set("command", "REQUEST_CLOSE_PROJECT");
  form.set("reason", reason);
  return form;
}

function decisionForm(closeRequestId) {
  const form = new FormData();
  form.set("command", "DECIDE_FINANCIAL_CLOSE");
  form.set("closeRequestId", closeRequestId);
  form.set("decision", "APPROVE");
  form.set("reason", "Đủ điều kiện đóng");
  return form;
}

async function requestClose(service, fx, expectedVersion = 0) {
  return service.executeFinance(fx.project.id, expectedVersion, fx.actors.owner, closeForm(), null);
}

test("financial close binds the exact approved manifest/version/hash and rejects every stale substitution", { timeout: 240_000 }, async () => {
  await withMigratedSchema(async ({ client, service }) => {
    const exact = await fixture(client, "exact");
    const requested = await requestClose(service, exact);
    const stored = await client.financialCloseRequest.findUniqueOrThrow({ where: { id: requested.closeRequestId } });
    assert.equal(stored.dossierVersionId, exact.version.id);
    assert.equal(stored.canonicalHash, exact.canonicalHash);
    assert.equal(stored.workspaceVersion, 1);
    await service.executeFinance(exact.project.id, 1, exact.actors.manager, decisionForm(stored.id), null);
    assert.equal((await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: exact.project.id } })).data.closed, true);

    for (const mismatch of ["missing", "extra", "wrong-version"]) {
      const fx = await fixture(client, `manifest-${mismatch}`);
      if (mismatch === "missing") await client.settlementLock.delete({ where: { id: fx.lock.id } });
      if (mismatch === "extra") {
        await client.settlementLock.create({ data: {
          projectId: fx.project.id, dossierVersionId: fx.version.id, obligationId: fx.obligation.id,
          recipientKey: fx.obligation.recipientKey, advanceApplicationId: fx.unrelatedAdvance.id,
          sourceCashAllocationId: fx.sourceAllocation.id,
        } });
      }
      if (mismatch === "wrong-version") {
        await client.settlementLock.delete({ where: { id: fx.lock.id } });
        const newer = await client.projectSettlementVersion.create({ data: {
          projectId: fx.project.id, dossierId: fx.dossier.id, requestId: fx.settlementRequest.id, version: 2,
          attemptId: `wrong-${randomUUID()}`, canonicalHash: sha("wrong-version"), createdById: fx.actors.owner.id,
        } });
        const newerObligation = await client.settlementRecipientObligation.create({ data: {
          projectId: fx.project.id, dossierVersionId: newer.id, recipientKey: fx.obligation.recipientKey,
          recipientType: "EMPLOYEE", direction: "ADDITIONAL", approvedAcGross: "1000", disbursedAdvance: "0", amountDue: "1000",
        } });
        await client.settlementLock.create({ data: {
          projectId: fx.project.id, dossierVersionId: newer.id, obligationId: newerObligation.id,
          recipientKey: fx.obligation.recipientKey, advanceApplicationId: fx.advance.id, sourceCashAllocationId: fx.sourceAllocation.id,
        } });
      }
      await assert.rejects(() => requestClose(service, fx), /manifest|khóa|lock|phiên bản/i);
    }

    for (const blocker of ["incomplete-additional", "incomplete-refund", "unsigned-liquidation", "ar-nonzero"]) {
      const fx = await fixture(client, blocker);
      if (blocker.startsWith("incomplete")) {
        await client.settlementCashAllocation.updateMany({ where: { obligationId: fx.obligation.id }, data: { amount: "999" } });
      }
      if (blocker === "incomplete-refund") {
        await client.settlementRecipientObligation.update({ where: { id: fx.obligation.id }, data: { direction: "REFUND" } });
        await client.costFlowCash.update({ where: { id: fx.settlementCash.id }, data: { direction: "IN" } });
      }
      if (blocker === "unsigned-liquidation") {
        await client.customerCashIn.deleteMany({ where: { projectId: fx.project.id } });
        await client.customerLiquidation.delete({ where: { id: fx.liquidation.id } });
      }
      if (blocker === "ar-nonzero") await client.customerCashIn.updateMany({ where: { projectId: fx.project.id }, data: { amount: "999" } });
      await assert.rejects(() => requestClose(service, fx), /công nợ|chứng từ|thanh lý|AR/i);
      assert.equal((await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: fx.project.id } })).data.closed, false);
    }

    const noEvidence = await fixture(client, "cash-no-evidence");
    await assert.rejects(
      () => client.$executeRawUnsafe(
        `INSERT INTO "CostFlowCash" ("id", "projectId", "requestId", "recipientKey", "direction", "channel", "amount", "reference", "idempotencyKey", "commandFingerprint", "allocations", "occurredAt", "confirmedBy") VALUES ($1,$2,$3,$4,'OUT','BANK_TRANSFER','1',$5,$6,$7,'[]'::jsonb,NOW(),$8)`,
        randomUUID(), noEvidence.project.id, noEvidence.settlementRequest.id, noEvidence.obligation.recipientKey,
        `NO-EVIDENCE-${randomUUID()}`, `no-evidence-${randomUUID()}`, sha("no-evidence"), noEvidence.actors.accountant.id,
      ),
      /evidenceId|null|constraint/i,
    );

    for (const stage of ["REQUESTED", "APPROVED", "VERSION_CREATED", "RECOVERY_PENDING", "PAYMENT_PENDING", "APPROVAL_PENDING", "SIGNING_PENDING"]) {
      const fx = await fixture(client, `correction-${stage.toLowerCase()}`);
      await client.settlementCorrectionAttempt.create({ data: {
        projectId: fx.project.id, dossierId: fx.dossier.id, baseVersionId: fx.version.id,
        requestedFieldScopes: ["ADD_NEW_AC"], requestedLockScopes: [], requestedById: fx.actors.owner.id,
        reason: `Open correction ${stage}`, stage,
      } });
      await assert.rejects(() => requestClose(service, fx), /vòng sửa|correction|chưa kết thúc/i);
    }

    for (const stage of ["REQUESTED", "APPROVED", "VERSION_CREATED", "RECOVERY_PENDING", "PAYMENT_PENDING", "APPROVAL_PENDING", "SIGNING_PENDING"]) {
      const fx = await fixture(client, `decision-correction-${stage.toLowerCase()}`);
      const result = await requestClose(service, fx);
      await client.settlementCorrectionAttempt.create({ data: {
        projectId: fx.project.id, dossierId: fx.dossier.id, baseVersionId: fx.version.id,
        requestedFieldScopes: ["ADD_NEW_AC"], requestedLockScopes: [], requestedById: fx.actors.owner.id,
        reason: `Decision correction ${stage}`, stage,
      } });
      await assert.rejects(
        () => service.executeFinance(fx.project.id, 1, fx.actors.manager, decisionForm(result.closeRequestId), null),
        /vòng sửa|correction|chưa kết thúc/i,
      );
      assert.equal(await client.financialCloseEvent.count({ where: { closeRequestId: result.closeRequestId } }), 1);
      assert.equal((await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: fx.project.id } })).data.closed, false);
    }

    for (const status of ["COMPLETED", "REJECTED", "CANCELLED"]) {
      const fx = await fixture(client, `terminal-${status.toLowerCase()}`);
      await client.settlementCorrectionAttempt.create({ data: {
        projectId: fx.project.id, dossierId: fx.dossier.id, baseVersionId: fx.version.id,
        requestedFieldScopes: ["ADD_NEW_AC"], requestedLockScopes: [], requestedById: fx.actors.owner.id,
        reason: `Terminal correction ${status}`, stage: status, status, terminalAt: new Date(),
      } });
      await requestClose(service, fx);
    }

    for (const drift of ["older", "newer", "hash", "version"]) {
      const fx = await fixture(client, `drift-${drift}`);
      const result = await requestClose(service, fx);
      const request = await client.financialCloseRequest.findUniqueOrThrow({ where: { id: result.closeRequestId } });
      if (drift === "older") await client.costFlowWorkspace.update({ where: { projectId: fx.project.id }, data: { version: 0 } });
      if (drift === "newer") await client.costFlowWorkspace.update({ where: { projectId: fx.project.id }, data: { version: 2 } });
      if (drift === "hash") await client.projectSettlementVersion.update({ where: { id: fx.version.id }, data: { canonicalHash: sha("substituted") } });
      if (drift === "version") await client.workflowRequest.update({ where: { id: fx.settlementRequest.id }, data: { state: "RETURNED" } });
      const currentWorkspace = await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: fx.project.id } });
      await assert.rejects(
        () => service.executeFinance(fx.project.id, currentWorkspace.version, fx.actors.manager, decisionForm(request.id), null),
        /phiên bản|hash|thay đổi|stale|approved|phê duyệt/i,
      );
      assert.equal((await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: fx.project.id } })).data.closed, false);
      assert.equal(await client.financialCloseEvent.count({ where: { closeRequestId: request.id } }), 1);
    }

    const correctionAfterRequest = await fixture(client, "correction-after-request");
    const result = await requestClose(service, correctionAfterRequest);
    await client.settlementCorrectionAttempt.create({ data: {
      projectId: correctionAfterRequest.project.id, dossierId: correctionAfterRequest.dossier.id,
      baseVersionId: correctionAfterRequest.version.id, requestedFieldScopes: ["ADD_NEW_AC"], requestedLockScopes: [],
      requestedById: correctionAfterRequest.actors.owner.id, reason: "Opened after close request", stage: "REQUESTED",
    } });
    await assert.rejects(
      () => service.executeFinance(correctionAfterRequest.project.id, 1, correctionAfterRequest.actors.manager, decisionForm(result.closeRequestId), null),
      /vòng sửa|correction|chưa kết thúc/i,
    );
    assert.equal(await client.financialCloseEvent.count({ where: { closeRequestId: result.closeRequestId } }), 1);

    const independentAxes = await fixture(client, "independent-axes");
    await client.settlementCashAllocation.updateMany({ where: { obligationId: independentAxes.obligation.id }, data: { amount: "1" } });
    await client.workflowApprovedSnapshot.create({ data: {
      requestId: independentAxes.settlementRequest.id, version: independentAxes.settlementRequest.version,
      mode: "DIGITAL", evidenceState: "DIGITAL_CONFIRMED", projection: { approved: true },
      projectionSha256: sha("signed"), attestationKeyId: "signing-key", attestation: "signed",
    } });
    await client.task.create({ data: {
      projectId: independentAxes.project.id, creatorId: independentAxes.actors.owner.id,
      title: "Settlement task", status: "DONE", completedAt: new Date(),
    } });
    await assert.rejects(() => requestClose(service, independentAxes), /công nợ|chưa thực hiện đủ|balance/i);
    assert.equal((await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: independentAxes.project.id } })).data.closed, false);
  });
});
