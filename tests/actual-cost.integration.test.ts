import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

function approvedDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Phase 8 test requires PostgreSQL");
  assert.equal(url.hostname, "127.0.0.1", "Phase 8 test only uses 127.0.0.1");
  assert.equal(url.port, "55439", "Phase 8 test only uses port 55439");
  assert.equal(url.pathname, "/costflow_test", "CostFlow automation only uses database costflow_test");
  return url;
}

test("actual-cost integration: create, submit, return, resubmit and approve are immutable", async () => {
  approvedDatabaseUrl(); // The exact DB guard runs before any fixture write.
  const { prisma } = await import("../lib/prisma");
  const { attachActualCostEvidence, executeActualCostBulkDecision, executeActualCostCommand, findActualCostEvidenceForActor } = await import("../lib/costflow/actualCostService");
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
          revisions: [{ id: `${prefix}-revision`, number: 1, requestId: `${prefix}-ic-request`, effective: true, lines: [
            { id: `${prefix}-ic-line`, description: "Dòng IC nguồn", unit: "gói", quantity: "2", days: "3", unitPrice: "100000", basis: "GROSS", vatPercent: "0", cost: { rawNet: "600000/1", rawVat: "0/1", rawGross: "600000/1", net: "600000", vat: "0", gross: "600000" } },
            ...["người", "xe", "phòng"].map((unit, index) => ({ id: `${prefix}-ic-${unit}`, description: `IC ${unit}`, unit, quantity: "1", days: "1", unitPrice: String((index + 1) * 10000), basis: "GROSS", vatPercent: "0", cost: { rawNet: `${(index + 1) * 10000}/1`, rawVat: "0/1", rawGross: `${(index + 1) * 10000}/1`, net: String((index + 1) * 10000), vat: "0", gross: String((index + 1) * 10000) } })),
          ], poIds: [], evidenceIds: [], createdBy: member.id }],
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
    const baselineBefore = JSON.stringify((await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId }, select: { data: true } })).data);

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

    for (const [index, unit] of ["gói", "người", "xe", "phòng"].entries()) {
      const icLineId = unit === "gói" ? `${prefix}-ic-line` : `${prefix}-ic-${unit}`;
      await executeActualCostCommand(member, {
        command: "CREATE_AND_SUBMIT", projectId, stableLineId: `${prefix}-occurrence-${index}`,
        revisionId: `${prefix}-revision`, icLineId, recipientKey: `USER:${member.id}`,
        description: `Đợt nghiệm thu ${unit}`, fundingSource: "EMPLOYEE_OUT_OF_POCKET",
        quantity: "1", days: "1", unitPrice: "10000",
      });
    }
    assert.equal(await prisma.actualCostLine.count({ where: { projectId, icLineId: `${prefix}-ic-line` } }), 2, "one immutable IC line accepts multiple actual occurrences");
    assert.deepEqual(
      new Set((await prisma.actualCostVersion.findMany({ where: { projectId }, select: { unit: true } })).map(item => item.unit)),
      new Set(["gói", "người", "xe", "phòng"]),
      "mixed units remain separate on versions",
    );
    const bulkCandidates = await prisma.actualCostLine.findMany({
      where: { projectId, stableLineId: { in: [`${prefix}-occurrence-0`, `${prefix}-occurrence-1`] } },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: { stableLineId: "asc" },
    });
    const validBulk = bulkCandidates.map(line => ({ lineId: line.id, version: line.currentVersion, reviewToken: `${line.versions[0].id}:${line.currentVersion}` }));
    const beforeBulkFailures = await prisma.actualCostApproval.count({ where: { projectId } });
    await assert.rejects(() => executeActualCostBulkDecision(dd, { projectId, action: "APPROVED", reason: "Bulk", acknowledgeMissingEvidence: true, selections: [validBulk[0], { ...validBulk[1], reviewToken: "stale:1" }] }), /phiên bản AC đã thay đổi/);
    await assert.rejects(() => executeActualCostBulkDecision(dd, { projectId, action: "APPROVED", reason: "Bulk", acknowledgeMissingEvidence: true, selections: [validBulk[0], { lineId: randomUUID(), version: 1, reviewToken: "foreign:1" }] }), /không thuộc đúng Project/);
    await assert.rejects(() => executeActualCostBulkDecision(admin, { projectId, action: "APPROVED", reason: "Bulk", acknowledgeMissingEvidence: true, selections: validBulk }), /AC_DD/);
    assert.equal(await prisma.actualCostApproval.count({ where: { projectId } }), beforeBulkFailures, "stale, foreign and non-DD bulk sets write zero decisions");
    const bulkApproved = await executeActualCostBulkDecision(dd, { projectId, action: "APPROVED", reason: "DD duyệt theo lô", acknowledgeMissingEvidence: true, selections: validBulk });
    assert.equal(bulkApproved.count, 2);
    assert.equal(await prisma.actualCostApproval.count({ where: { lineId: { in: validBulk.map(item => item.lineId) }, action: "APPROVED" } }), 2);

    const evidence = await prisma.costFlowEvidence.create({ data: {
      projectId, sourceFileId: `${prefix}-evidence`, kind: "VAT_INVOICE", name: "invoice.pdf",
      mimeType: "application/pdf", data: new Uint8Array([1, 2, 3]), sha256: `${prefix}-sha`, createdBy: member.id,
    } });
    await assert.rejects(() => executeActualCostCommand(member, {
      command: "CREATE_AND_SUBMIT", projectId, stableLineId: `${prefix}-unbudgeted-invalid`, sourceKind: "UNBUDGETED",
      recipientKey: `USER:${member.id}`, description: "Phát sinh", reason: "", fundingSource: "EMPLOYEE_OUT_OF_POCKET",
      quantity: "1", days: "1", unitPrice: "90000", unit: "gói", evidenceIds: [evidence.id],
    }), /lý do phát sinh/);
    const unbudgeted = await executeActualCostCommand(member, {
      command: "CREATE_AND_SUBMIT", projectId, stableLineId: `${prefix}-unbudgeted`, sourceKind: "UNBUDGETED",
      recipientKey: `USER:${member.id}`, description: "Phát sinh", reason: "Khách đổi yêu cầu", fundingSource: "EMPLOYEE_OUT_OF_POCKET",
      quantity: "1", days: "1", unitPrice: "90000", unit: "gói", evidenceIds: [evidence.id], billable: true,
      saleQuantity: "1", saleDays: "1", saleUnitPrice: "120000",
    });
    const unbudgetedVersion = await prisma.actualCostVersion.findUniqueOrThrow({ where: { id: unbudgeted.versionId }, include: { evidenceLinks: true } });
    assert.equal(unbudgetedVersion.amount, "90000", "sale metadata never changes approved AC amount");
    assert.equal(unbudgetedVersion.billable, true);
    assert.equal(unbudgetedVersion.evidenceLinks.length, 1);
    await executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: unbudgeted.lineId, version: 1, reviewToken: `${unbudgeted.versionId}:1`, acknowledgeMissingEvidence: true, action: "APPROVED", reason: "DD duyệt phát sinh" });
    assert.equal(JSON.stringify((await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId }, select: { data: true } })).data), baselineBefore, "AC writes and approvals do not mutate effective IC or parameter snapshots");

    const beforeUnauthorized = {
      approvals: await prisma.actualCostApproval.count({ where: { projectId } }),
      versions: await prisma.actualCostVersion.count({ where: { projectId } }),
    };
    await assert.rejects(
      () => executeActualCostCommand(admin, { command: "DECIDE", projectId, lineId: created.lineId, version: 1, reviewToken: `${created.versionId}:1`, acknowledgeMissingEvidence: true, action: "APPROVED", reason: "Admin không phải DD" }),
      /AC_DD/,
    );
    assert.deepEqual({
      approvals: await prisma.actualCostApproval.count({ where: { projectId } }),
      versions: await prisma.actualCostVersion.count({ where: { projectId } }),
    }, beforeUnauthorized, "non-DD rejection is a zero-write assertion");

    await assert.rejects(
      () => executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 1, reviewToken: `${created.versionId}:1`, action: "RETURNED", reason: "" }),
      /lý do/,
    );
    await executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 1, reviewToken: `${created.versionId}:1`, action: "RETURNED", reason: "Bổ sung diễn giải" });
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
      () => executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 1, reviewToken: `${created.versionId}:1`, acknowledgeMissingEvidence: true, action: "APPROVED", reason: "Lệnh cũ" }),
      /phiên bản đã thay đổi/,
    );
    await assert.rejects(
      () => executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 2, reviewToken: `${resubmitted.versionId}:2`, action: "APPROVED", reason: "Thiếu xác nhận" }),
      /xác nhận rõ việc duyệt/,
    );
    await executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 2, reviewToken: `${resubmitted.versionId}:2`, acknowledgeMissingEvidence: true, action: "APPROVED", reason: "Đạt" });
    await assert.rejects(
      () => executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: created.lineId, version: 2, reviewToken: `${resubmitted.versionId}:2`, acknowledgeMissingEvidence: true, action: "APPROVED", reason: "Replay" }),
      /đã được quyết định/,
    );
    assert.equal(await prisma.actualCostApproval.count({ where: { projectId, lineId: created.lineId, action: "APPROVED" } }), 1);
    assert.deepEqual(await prisma.actualCostApproval.findFirst({ where: { projectId, lineId: created.lineId, action: "APPROVED" }, select: { warningCodes: true } }).then(item => item?.warningCodes), ["MISSING_ACCEPTANCE_HANDOVER", "MISSING_VAT_INVOICE", "MISSING_PAYMENT_PROOF"]);
    assert.equal(await prisma.costFlowCash.count({ where: { projectId } }), 0);

    const createdApproval = await prisma.actualCostApproval.findFirstOrThrow({ where: { lineId: created.lineId, action: "APPROVED" } });
    const unbudgetedApproval = await prisma.actualCostApproval.findFirstOrThrow({ where: { lineId: unbudgeted.lineId, action: "APPROVED" } });
    const { resolveProductionApprovedActualCost } = await import("../lib/costflow/approvedActualCost");
    const resolvedApproved = await resolveProductionApprovedActualCost({ projectId, lineIds: [
      `${prefix}-stable-line`, `${prefix}-unbudgeted`,
    ], lineRefs: [
      { stableLineId: `${prefix}-stable-line`, versionId: resubmitted.versionId, approvalEventId: createdApproval.id, approvalAttemptId: createdApproval.attemptId },
      { stableLineId: `${prefix}-unbudgeted`, versionId: unbudgeted.versionId, approvalEventId: unbudgetedApproval.id, approvalAttemptId: unbudgetedApproval.attemptId },
    ] });
    assert.deepEqual(resolvedApproved.map(line => line.stableLineId).sort(), [`${prefix}-stable-line`, `${prefix}-unbudgeted`].sort(), "independently approved lines retain per-line provenance");
    await assert.rejects(() => resolveProductionApprovedActualCost({ projectId, versionId: resubmitted.versionId, approvalEventId: unbudgetedApproval.id, approvalAttemptId: createdApproval.attemptId, lineIds: [`${prefix}-stable-line`] }), /không khớp|chưa có đủ/);

    const consumingRequest = await prisma.workflowRequest.create({ data: { projectId, module: "COSTFLOW", kind: "REIMBURSEMENT", title: `${prefix} settlement`, creatorId: member.id, cashAssigneeId: member.id, state: "SUBMITTED", steps: [], payload: {} } });
    const application = await prisma.actualCostApplication.create({ data: { projectId, lineId: created.lineId, versionId: resubmitted.versionId, approvalId: createdApproval.id, requestId: consumingRequest.id, recipientKey: `USER:${member.id}`, amount: resubmitted.amount, createdById: member.id } });
    const lateBytes = new TextEncoder().encode("locked evidence");
    await assert.rejects(() => attachActualCostEvidence(member, { projectId, lineId: created.lineId, expectedVersion: 2, kind: "FIELD_PHOTO_REPORT" }, [{ name: "locked.txt", mimeType: "text/plain", size: lateBytes.byteLength, data: lateBytes }]), /đã bị khóa/);
    await prisma.workflowRequest.update({ where: { id: consumingRequest.id }, data: { state: "CANCELLED" } });
    await prisma.actualCostApplication.update({ where: { id: application.id }, data: { state: "RELEASED", releasedAt: new Date() } });
    const unlocked = await attachActualCostEvidence(member, { projectId, lineId: created.lineId, expectedVersion: 2, kind: "FIELD_PHOTO_REPORT" }, [{ name: "released.txt", mimeType: "text/plain", size: lateBytes.byteLength, data: lateBytes }]);
    assert.equal(unlocked.version, 3, "valid cancellation release unlocks a new immutable manifest version");

    const replacementDd = await createUser("replacement-dd");
    await prisma.projectMember.create({ data: { projectId, userId: replacementDd.id } });
    const replacementForm = new FormData();
    replacementForm.set("command", "GRANT_APPROVAL_ROLE");
    replacementForm.set("userId", replacementDd.id);
    replacementForm.set("approvalRole", "AC_DD");
    const { executeWorkflow } = await import("../lib/workflow/service");
    await executeWorkflow(admin, replacementForm, null);
    assert.deepEqual(
      await prisma.workflowRoleGrant.findMany({ where: { role: "AC_DD", revokedAt: null }, select: { userId: true } }),
      [{ userId: replacementDd.id }],
      "Admin replacement keeps exactly one active company DD",
    );
    await assert.rejects(
      () => prisma.workflowRoleGrant.create({ data: { userId: dd.id, role: "AC_DD", grantedById: admin.id } }),
      /Unique constraint failed/,
      "the partial unique index rejects a second active AC_DD",
    );

    const notificationFailure = await executeActualCostCommand(member, {
      command: "CREATE_AND_SUBMIT",
      projectId,
      stableLineId: `${prefix}-notification-durable`,
      revisionId: `${prefix}-revision`,
      icLineId: `${prefix}-ic-line`,
      recipientKey: `USER:${member.id}`,
      description: "AC survives notification failure",
      fundingSource: "EMPLOYEE_ADVANCE",
      quantity: "1",
      days: "1",
      unitPrice: "50000",
    }, { notify: async () => { throw new Error("synthetic notification outage"); } });
    assert.equal(await prisma.actualCostVersion.count({ where: { id: notificationFailure.versionId, state: "SUBMITTED" } }), 1, "durable event survives notification failure");
    const beforeOldDd = await prisma.actualCostApproval.count({ where: { lineId: notificationFailure.lineId } });
    await assert.rejects(
      () => executeActualCostCommand(dd, { command: "DECIDE", projectId, lineId: notificationFailure.lineId, version: 1, reviewToken: `${notificationFailure.versionId}:1`, acknowledgeMissingEvidence: true, action: "APPROVED", reason: "Old DD" }),
      /AC_DD/,
    );
    assert.equal(await prisma.actualCostApproval.count({ where: { lineId: notificationFailure.lineId } }), beforeOldDd, "stale DD writes no decision");
    const concurrentDecision = await Promise.allSettled([
      executeActualCostCommand(replacementDd, { command: "DECIDE", projectId, lineId: notificationFailure.lineId, version: 1, reviewToken: `${notificationFailure.versionId}:1`, acknowledgeMissingEvidence: true, action: "APPROVED", reason: "Replacement DD approved A" }),
      executeActualCostCommand(replacementDd, { command: "DECIDE", projectId, lineId: notificationFailure.lineId, version: 1, reviewToken: `${notificationFailure.versionId}:1`, acknowledgeMissingEvidence: true, action: "APPROVED", reason: "Replacement DD approved B" }),
    ]);
    assert.equal(concurrentDecision.filter(result => result.status === "fulfilled").length, 1, "concurrent DD decisions have exactly one winner");
    assert.equal(await prisma.actualCostApproval.count({ where: { lineId: notificationFailure.lineId, action: "APPROVED" } }), 1, "concurrent loser writes no duplicate decision");

    let evidenceVersion = 1;
    const evidenceKinds = ["VENDOR_CONTRACT_PO", "ACCEPTANCE_HANDOVER", "VAT_INVOICE", "PAYMENT_PROOF", "FIELD_PHOTO_REPORT"] as const;
    const evidenceIds: string[] = [];
    for (const kind of evidenceKinds) {
      const bytes = new TextEncoder().encode(`${prefix}:${kind}`);
      const attached = await attachActualCostEvidence(member, { projectId, lineId: notificationFailure.lineId, expectedVersion: evidenceVersion, kind }, [{
        name: `${kind}.txt`, mimeType: "text/plain", size: bytes.byteLength, data: bytes,
      }]);
      evidenceVersion = attached.version;
      evidenceIds.push(attached.evidence[0].id);
      assert.equal(attached.evidence[0].sha256, createHash("sha256").update(bytes).digest("hex"));
    }
    assert.equal(evidenceVersion, 6, "each late evidence upload creates immutable manifest history");
    assert.equal(await prisma.actualCostVersion.count({ where: { lineId: notificationFailure.lineId } }), 6);
    const latestEvidenceVersion = await prisma.actualCostVersion.findFirstOrThrow({ where: { lineId: notificationFailure.lineId, version: evidenceVersion }, include: { evidenceLinks: true } });
    assert.equal(latestEvidenceVersion.evidenceLinks.length, 5, "all five typed files remain linked on the latest manifest");
    assert.equal(await prisma.actualCostEvidenceLink.count({ where: { versionId: notificationFailure.versionId } }), 0, "the previously reviewed version is never rewritten");
    const readable = await findActualCostEvidenceForActor(projectId, evidenceIds[0], member);
    assert.equal(new TextDecoder().decode(readable?.data), `${prefix}:VENDOR_CONTRACT_PO`);
    const outsider = await createUser("outsider");
    assert.equal(await findActualCostEvidenceForActor(projectId, evidenceIds[0], outsider), null, "outsider learns nothing about linked evidence");
    assert.equal(await findActualCostEvidenceForActor(randomUUID(), evidenceIds[0], member), null, "wrong Project does not substitute evidence");
    await executeActualCostCommand(replacementDd, { command: "DECIDE", projectId, lineId: notificationFailure.lineId, version: evidenceVersion, reviewToken: `${latestEvidenceVersion.id}:${evidenceVersion}`, action: "APPROVED", reason: "Đủ manifest" });

    await prisma.workflowRoleGrant.updateMany({ where: { role: "AC_DD", revokedAt: null }, data: { revokedAt: new Date() } });
    const missingDdLine = await executeActualCostCommand(member, {
      command: "CREATE_AND_SUBMIT",
      projectId,
      stableLineId: `${prefix}-missing-dd`,
      revisionId: `${prefix}-revision`,
      icLineId: `${prefix}-ic-line`,
      recipientKey: `USER:${member.id}`,
      description: "AC waits when DD is missing",
      fundingSource: "EMPLOYEE_ADVANCE",
      quantity: "1",
      days: "1",
      unitPrice: "25000",
    });
    const beforeMissingDd = await prisma.actualCostApproval.count({ where: { lineId: missingDdLine.lineId } });
    await assert.rejects(
      () => executeActualCostCommand(replacementDd, { command: "DECIDE", projectId, lineId: missingDdLine.lineId, version: 1, reviewToken: `${missingDdLine.versionId}:1`, acknowledgeMissingEvidence: true, action: "APPROVED", reason: "No active DD" }),
      /duy nhất một AC_DD/,
    );
    assert.equal(await prisma.actualCostApproval.count({ where: { lineId: missingDdLine.lineId } }), beforeMissingDd, "missing DD writes no decision");
    await executeWorkflow(admin, replacementForm, null);
  } finally {
    if (projectId) {
      await prisma.actualCostApplication.deleteMany({ where: { projectId } });
      await prisma.actualCostEvidenceLink.deleteMany({ where: { projectId } });
      await prisma.actualCostApproval.deleteMany({ where: { projectId } });
      await prisma.actualCostVersion.deleteMany({ where: { projectId } });
      await prisma.actualCostLine.deleteMany({ where: { projectId } });
      await prisma.costFlowEvidence.deleteMany({ where: { projectId } });
      await prisma.workflowRequest.deleteMany({ where: { projectId, title: { startsWith: prefix } } });
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
