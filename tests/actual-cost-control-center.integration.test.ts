import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

function approvedDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55439");
  assert.equal(url.pathname, "/taskflow");
}

test("control-center integration enforces self, accountant and Project Operations scopes", async () => {
  approvedDatabaseUrl();
  const { prisma } = await import("../lib/prisma");
  const { loadActualCosts } = await import("../lib/costflow/actualCostReadModel");
  const prefix = `phase8-control-${randomUUID()}`;
  const userIds: string[] = [];
  const projectIds: string[] = [];
  const createUser = async (label: string, role = "USER", isActive = true) => {
    const user = await prisma.user.create({ data: { email: `${prefix}-${label}@example.test`, name: `${prefix} ${label}`, role, isActive, passwordHash: "unused" } });
    userIds.push(user.id);
    return user;
  };
  try {
    const account = await createUser("account", "ACCOUNT");
    const self = await createUser("self");
    const other = await createUser("other");
    const operation = await createUser("operation");
    const inactiveOperation = await createUser("inactive-operation", "USER", false);
    const accountant = await createUser("accountant");
    const dd = await createUser("dd");
    const outsider = await createUser("outsider");
    const admin = await createUser("admin", "ADMIN");
    const project = await prisma.project.create({ data: { name: prefix, ownerId: account.id, members: { create: [account, self, other, operation, inactiveOperation].map(user => ({ userId: user.id })) } } });
    projectIds.push(project.id);
    const foreign = await prisma.project.create({ data: { name: `${prefix}-foreign`, ownerId: outsider.id, members: { create: { userId: outsider.id } } } });
    projectIds.push(foreign.id);
    const revisionId = `${prefix}-revision`;
    const icLineId = `${prefix}-ic`;
    await prisma.costFlowWorkspace.create({ data: { projectId: project.id, data: {
      config: { accountantId: accountant.id, ceoId: admin.id, managerId: admin.id, operationUserIds: [operation.id, inactiveOperation.id, outsider.id] },
      closed: false,
      revisions: [{ id: revisionId, number: 1, requestId: `${prefix}-request`, effective: true, lines: [{ id: icLineId, description: "IC", unit: "gói", quantity: "1", days: "1", unitPrice: "3000", basis: "GROSS", vatPercent: "0", cost: { rawNet: "3000/1", rawVat: "0/1", rawGross: "3000/1", net: "3000", vat: "0", gross: "3000" } }], poIds: [], evidenceIds: [], createdBy: account.id }],
      beneficiaries: [{ id: `${prefix}-vendor`, name: "PRIVATE_VENDOR", bank: "PRIVATE_BANK", account: "PRIVATE_ACCOUNT", version: 1, verifiedVersion: 1, proofId: "proof" }], expenses: [], pos: [], quotations: [], briefs: [], vendorPaymentMilestones: [],
    } } });
    await prisma.workflowRoleGrant.create({ data: { userId: dd.id, role: "AC_DD", grantedById: admin.id } });
    const createActual = async (stableLineId: string, recipientKey: string, createdById: string, fundingSource: string, amount: string) => {
      const line = await prisma.actualCostLine.create({ data: { projectId: project.id, stableLineId, sourceKind: "IC_LINKED", icRevisionId: revisionId, icLineId, recipientKey, createdById, currentVersion: 1 } });
      await prisma.actualCostVersion.create({ data: { projectId: project.id, lineId: line.id, version: 1, state: "APPROVED", description: stableLineId, fundingSource, quantity: "1", days: "1", unitPrice: amount, unit: "gói", amount, rawAmount: `${amount}/1`, sourceSnapshot: { quantity: "1", days: "1", unitPrice: "3000", basis: "GROSS", vatPercent: "0", cost: { gross: "3000" } }, createdById, submittedAt: new Date() } });
    };
    await createActual(`${prefix}-self`, `USER:${self.id}`, self.id, "EMPLOYEE_OUT_OF_POCKET", "1000");
    await createActual(`${prefix}-other`, `USER:${other.id}`, other.id, "EMPLOYEE_OUT_OF_POCKET", "500");
    await createActual(`${prefix}-vendor-ac`, `VENDOR:${prefix}-vendor`, account.id, "VENDOR_PAYMENT", "1200");

    const selfView = await loadActualCosts(project.id, self);
    assert.ok(selfView);
    assert.deepEqual(selfView.lines.map(line => line.recipientKey), [`USER:${self.id}`]);
    assert.equal(JSON.stringify(selfView.controlCenter).includes(`${prefix}-other`), false);
    assert.equal(JSON.stringify(selfView.controlCenter).includes("PRIVATE_VENDOR"), false);
    assert.deepEqual(selfView.controlCenter.capabilities.lenses, ["SELF"]);

    const operationView = await loadActualCosts(project.id, operation);
    assert.ok(operationView);
    assert.equal(operationView.controlCenter.capabilities.vendorOperations, true);
    assert.deepEqual(operationView.lines.map(line => line.recipientKey), [`VENDOR:${prefix}-vendor`]);
    assert.equal(JSON.stringify(operationView.lines).includes("PRIVATE_BANK"), false);
    assert.equal(operationView.controlCenter.capabilities.canDecide, false);

    const accountantView = await loadActualCosts(project.id, accountant);
    assert.ok(accountantView);
    assert.equal(accountantView.controlCenter.capabilities.audit, true);
    assert.equal(accountantView.lines.length, 3);
    const ddView = await loadActualCosts(project.id, dd);
    assert.equal(ddView?.controlCenter.capabilities.canDecide, true);
    assert.equal(await loadActualCosts(project.id, outsider), null, "foreign Project assignment is ignored");
    assert.equal(await loadActualCosts(project.id, inactiveOperation), null, "inactive Project member is ignored");
  } finally {
    if (projectIds.length) {
      await prisma.actualCostEvidenceLink.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.actualCostApproval.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.actualCostApplication.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.actualCostVersion.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.actualCostLine.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.workflowRoleGrant.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});
