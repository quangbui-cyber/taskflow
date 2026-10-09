import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function approvedDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Phase 8 test requires PostgreSQL");
  assert.equal(url.hostname, "127.0.0.1", "Phase 8 test only uses 127.0.0.1");
  assert.equal(url.port, "55439", "Phase 8 test only uses port 55439");
  assert.equal(url.pathname, "/taskflow", "Phase 8 test only uses database taskflow");
  return url;
}

test("actual-cost integration: create, submit, return, resubmit and approve are immutable", async () => {
  approvedDatabaseUrl(); // The exact DB guard runs before any fixture write.
  const { prisma } = await import("../lib/prisma");
  const { executeActualCostCommand } = await import("../lib/costflow/actualCostService");
  const prefix = `phase8-ac-${randomUUID()}`;
  const userIds: string[] = [];
  let projectId = "";

  try {
    const createUser = async (label: string, role = "USER") => {
      const user = await prisma.user.create({
        data: { email: `${prefix}-${label}@example.test`, name: `${prefix} ${label}`, role, passwordHash: "unused" },
      });
      userIds.push(user.id);
      return user;
    };
    const member = await createUser("member", "ACCOUNT");
    const dd = await createUser("dd");
    const admin = await createUser("admin", "ADMIN");
    const project = await prisma.project.create({
      data: { name: prefix, ownerId: member.id, members: { create: [{ userId: member.id }, { userId: dd.id }, { userId: admin.id }] } },
    });
    projectId = project.id;
    await prisma.costFlowWorkspace.create({
      data: {
        projectId,
        data: {
          config: { accountantId: "", ceoId: "", managerId: "" },
          closed: false,
          revisions: [{ id: `${prefix}-revision`, number: 1, requestId: `${prefix}-ic-request`, effective: true, lines: [{ id: `${prefix}-ic-line`, description: "Dòng IC nguồn", unit: "gói", quantity: "2", days: "3", unitPrice: "100000", basis: "GROSS", vatPercent: "0", cost: { rawNet: "600000/1", rawVat: "0/1", rawGross: "600000/1", net: "600000", vat: "0", gross: "600000" } }], poIds: [], evidenceIds: [], createdBy: member.id }],
          beneficiaries: [],
          expenses: [],
          pos: [],
          quotations: [],
          briefs: [],
          vendorPaymentMilestones: [],
        },
      },
    });
    await prisma.workflowRoleGrant.create({ data: { userId: dd.id, role: "AC_DD", grantedById: admin.id } });

    const created = await executeActualCostCommand(member, {
      command: "CREATE_AND_SUBMIT",
      projectId,
      stableLineId: `${prefix}-stable-line`,
      revisionId: `${prefix}-revision`,
      icLineId: `${prefix}-ic-line`,
      recipientKey: `USER:${member.id}`,
      description: "Chi phí thực tế",
      fundingSource: "EMPLOYEE_OUT_OF_POCKET",
      quantity: "2",
      days: "3",
      unitPrice: "100000",
    });
    assert.equal(created.version, 1);
    assert.equal(created.amount, "600000");
    assert.equal(await prisma.costFlowCash.count({ where: { projectId } }), 0);

    const beforeUnauthorized = {
      approvals: await prisma.actualCostApproval.count({ where: { projectId } }),
      versions: await prisma.actualCostVersion.count({ where: { projectId } }),
    };
    await assert.rejects(
      () => executeActualCostCommand(admin, { command: "DECIDE", projectId, lineId: created.lineId, version: 1, action: "APPROVED", reason: "Admin không phải DD" }),
      /AC_DD/,
    );
    assert.deepEqual({
      approvals: await prisma.actualCostApproval.count({ where: { projectId } }),
      versions: await prisma.actualCostVersion.count({ where: { projectId } }),
    }, beforeUnauthorized, "non-DD rejection is a zero-write assertion");

    await assert.rejects(
      () => executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 1, action: "RETURNED", reason: "" }),
      /lý do/,
    );
    await executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 1, action: "RETURNED", reason: "Bổ sung diễn giải" });
    const resubmitted = await executeActualCostCommand(member, {
      command: "RESUBMIT",
      projectId,
      lineId: created.lineId,
      expectedVersion: 1,
      description: "Chi phí thực tế đã sửa",
      fundingSource: "EMPLOYEE_OUT_OF_POCKET",
      quantity: "2",
      days: "4",
      unitPrice: "100000",
    });
    assert.equal(resubmitted.version, 2);
    assert.equal(await prisma.actualCostVersion.count({ where: { lineId: created.lineId } }), 2);

    await assert.rejects(
      () => executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 1, action: "APPROVED", reason: "Lệnh cũ" }),
      /phiên bản đã thay đổi/,
    );
    await executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 2, action: "APPROVED", reason: "Đạt" });
    await assert.rejects(
      () => executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 2, action: "APPROVED", reason: "Replay" }),
      /đã được quyết định/,
    );
    assert.equal(await prisma.actualCostApproval.count({ where: { projectId, action: "APPROVED" } }), 1);
    assert.equal(await prisma.costFlowCash.count({ where: { projectId } }), 0);
  } finally {
    if (projectId) {
      await prisma.actualCostApplication.deleteMany({ where: { projectId } });
      await prisma.actualCostEvidenceLink.deleteMany({ where: { projectId } });
      await prisma.actualCostApproval.deleteMany({ where: { projectId } });
      await prisma.actualCostVersion.deleteMany({ where: { projectId } });
      await prisma.actualCostLine.deleteMany({ where: { projectId } });
      await prisma.workflowRoleGrant.deleteMany({ where: { userId: { in: userIds }, role: "AC_DD" } });
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId, name: prefix } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds }, email: { startsWith: prefix } } });
  }
});

test("actual-cost integration: legacy JSON remains legacy/needsReview with no approved contract", async () => {
  approvedDatabaseUrl();
  const { prisma } = await import("../lib/prisma");
  const { loadActualCosts } = await import("../lib/costflow/actualCostReadModel");
  const prefix = `phase8-legacy-${randomUUID()}`;
  let userId = "";
  let projectId = "";
  try {
    const user = await prisma.user.create({ data: { email: `${prefix}@example.test`, name: prefix, role: "ACCOUNT", passwordHash: "unused" } });
    userId = user.id;
    const project = await prisma.project.create({ data: { name: prefix, ownerId: user.id, members: { create: { userId: user.id } } } });
    projectId = project.id;
    await prisma.costFlowWorkspace.create({ data: { projectId, data: { config: { accountantId: "", ceoId: "", managerId: "" }, closed: false, revisions: [], beneficiaries: [], pos: [], expenses: [{ id: `${prefix}-expense`, revisionId: "legacy-revision", lineId: "legacy-line", recipientKey: `USER:${user.id}`, description: "Legacy", input: { quantity: "1", unitPrice: "100000", basis: "GROSS", vatPercent: "0" }, cost: { rawNet: "100000/1", rawVat: "0/1", rawGross: "100000/1", net: "100000", vat: "0", gross: "100000" }, invoiceId: "invoice", paymentProofId: "proof", createdBy: user.id }], quotations: [], briefs: [], vendorPaymentMilestones: [] } } });
    const result = await loadActualCosts(projectId, user);
    assert.ok(result);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].source, "legacy");
    assert.equal(result.lines[0].reviewState, "needsReview");
    assert.equal(await prisma.actualCostApproval.count({ where: { projectId, action: "APPROVED" } }), 0, "legacy read has a zero-write approved assertion");
  } finally {
    if (projectId) {
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId, name: prefix } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId, email: `${prefix}@example.test` } });
  }
});
