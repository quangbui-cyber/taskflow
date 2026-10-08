import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function approvedDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Phase 7 test requires PostgreSQL");
  assert.equal(url.hostname, "127.0.0.1", "Phase 7 test only uses 127.0.0.1");
  assert.equal(url.port, "55439", "Phase 7 test only uses port 55439");
  assert.equal(url.pathname, "/taskflow", "Phase 7 test only uses database taskflow");
  return url;
}

test("payment-integration: approved DB guard runs before any fixture write", async () => {
  const url = approvedDatabaseUrl();
  const { prisma } = await import("../lib/prisma");
  const prefix = `phase7-payment-${randomUUID()}`;
  const createdUserIds: string[] = [];
  let projectId = "";
  let requestId = "";

  try {
    const owner = await prisma.user.create({
      data: { email: `${prefix}-owner@example.test`, name: `${prefix} owner`, role: "ACCOUNT", passwordHash: "unused" },
    });
    createdUserIds.push(owner.id);
    const project = await prisma.project.create({ data: { name: prefix, ownerId: owner.id } });
    projectId = project.id;
    const request = await prisma.workflowRequest.create({
      data: {
        projectId,
        module: "COSTFLOW",
        kind: "ADVANCE",
        title: `${prefix} dossier`,
        creatorId: owner.id,
        cashAssigneeId: owner.id,
        state: "DRAFT",
        steps: [],
        payload: { milestone: "Legacy-compatible header" },
      },
    });
    requestId = request.id;
    const recipient = await prisma.paymentRecipientSnapshot.create({
      data: {
        projectId,
        requestId,
        recipientKey: `USER:${owner.id}`,
        recipientType: "EMPLOYEE",
        displayName: owner.name,
        accountLast4: "1234",
        totalAmount: "1000000",
      },
    });
    const line = await prisma.paymentRequestLine.create({
      data: {
        projectId,
        requestId,
        stableKey: `${prefix}-line`,
        position: 0,
        description: "Phase 7 normalized line",
        amount: "1000000",
        icRevisionId: `${prefix}-revision`,
        icLineId: `${prefix}-ic-line`,
        sourceSnapshot: { projectId, effective: true },
        recipientKey: recipient.recipientKey,
        evidenceManifest: [],
      },
    });
    const cash = await prisma.costFlowCash.create({
      data: {
        projectId,
        requestId,
        recipientKey: recipient.recipientKey,
        direction: "OUT",
        channel: "BANK_TRANSFER",
        amount: "1000000",
        reference: `${prefix}-reference`,
        idempotencyKey: `${prefix}-idempotency`,
        commandFingerprint: `${prefix}-fingerprint`,
        allocations: [{ requestLineId: line.id, amount: "1000000" }],
        evidenceId: `${prefix}-evidence`,
        occurredAt: new Date(),
        confirmedBy: owner.id,
      },
    });
    await prisma.costFlowCashAllocation.create({
      data: {
        projectId,
        cashId: cash.id,
        requestId,
        requestLineId: line.id,
        recipientKey: recipient.recipientKey,
        direction: "OUT",
        amount: "1000000",
      },
    });

    assert.equal(project.name, prefix);
    assert.equal(url.pathname, "/taskflow");
    assert.equal((await prisma.paymentRequestLine.findMany({ where: { projectId } })).length, 1);
    const savedCash = await prisma.costFlowCash.findUniqueOrThrow({
      where: { projectId_idempotencyKey: { projectId, idempotencyKey: `${prefix}-idempotency` } },
      include: { normalizedAllocations: true },
    });
    assert.equal(savedCash.commandFingerprint, `${prefix}-fingerprint`);
    assert.equal(savedCash.channel, "BANK_TRANSFER");
    assert.equal(savedCash.normalizedAllocations[0].direction, "OUT");
  } finally {
    if (projectId) {
      await prisma.costFlowCashAllocation.deleteMany({ where: { projectId } });
      await prisma.costFlowCash.deleteMany({ where: { projectId } });
      await prisma.paymentLineDiscussion.deleteMany({ where: { projectId } });
      await prisma.advanceApplication.deleteMany({ where: { projectId } });
      await prisma.paymentRequestLine.deleteMany({ where: { projectId } });
      await prisma.paymentRecipientSnapshot.deleteMany({ where: { projectId } });
      if (requestId) await prisma.workflowRequest.deleteMany({ where: { id: requestId, projectId } });
      await prisma.project.deleteMany({ where: { id: projectId, name: prefix } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds }, email: { startsWith: prefix } } });
    }
  }
});
