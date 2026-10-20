import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function assertAuthorizedLocalDatabase() {
  assert.equal(process.env.DATABASE_URL, "postgresql://postgres@127.0.0.1:55439/taskflow", "Only the authorized local taskflow database may be used.");
}

test("Excel paste commits one draft transaction or rolls back every line", async () => {
  assertAuthorizedLocalDatabase();
  const { prisma } = await import("../lib/prisma");
  const { executeActualCostCommand } = await import("../lib/costflow/actualCostService");
  const prefix = `phase8-paste-${randomUUID()}`;
  let projectId = "";
  const userIds: string[] = [];
  try {
    assert.equal(await prisma.workflowRoleGrant.count({ where: { role: "AC_DD", revokedAt: null } }), 0, "the isolated test may not replace a real active DD");
    const account = await prisma.user.create({ data: { email: `${prefix}-account@example.test`, name: `${prefix} Account`, role: "ACCOUNT", passwordHash: "unused" } });
    userIds.push(account.id);
    const contributor = await prisma.user.create({ data: { email: `${prefix}-contributor@example.test`, name: `${prefix} Contributor`, role: "USER", passwordHash: "unused" } });
    userIds.push(contributor.id);
    const dd = await prisma.user.create({ data: { email: `${prefix}-dd@example.test`, name: `${prefix} DD`, role: "USER", passwordHash: "unused" } });
    userIds.push(dd.id);
    const project = await prisma.project.create({
      data: { name: prefix, ownerId: account.id, members: { create: [{ userId: account.id }, { userId: contributor.id }] } },
    });
    projectId = project.id;
    const revisionId = `${prefix}-ic`;
    const icLineId = `${prefix}-ic-line`;
    await prisma.costFlowWorkspace.create({ data: { projectId, data: {
      config: { accountantId: account.id, ceoId: "", managerId: "", operationUserIds: [contributor.id] },
      closed: false,
      revisions: [{ id: revisionId, number: 1, requestId: `${prefix}-ic-request`, effective: true, lines: [{
        id: icLineId, description: "Âm thanh", unit: "bộ", quantity: "2", days: "1", unitPrice: "100000", basis: "NET", vatPercent: "0",
        cost: { rawNet: "200000/1", rawVat: "0/1", rawGross: "200000/1", net: "200000", vat: "0", gross: "200000" },
      }], poIds: [], evidenceIds: [], createdBy: account.id }],
      beneficiaries: [], expenses: [], pos: [], quotations: [], briefs: [], vendorPaymentMilestones: [],
    } } });
    await prisma.workflowRoleGrant.create({ data: { userId: dd.id, role: "AC_DD", grantedById: account.id } });
    const line = (description: string, recipientKey = `USER:${contributor.id}`, unitPrice = "100000") => ({
      sourceKind: "IC_LINKED" as const, icLineId, recipientKey, description,
      reason: "", fundingSource: "EMPLOYEE_OUT_OF_POCKET", quantity: "1", days: "1", unitPrice, unit: "bộ", basis: "NET" as const, vatPercent: "0", evidenceIds: [], billable: false,
    });
    await assert.rejects(() => executeActualCostCommand(contributor, {
      command: "SAVE_LINES", projectId, revisionId,
      lines: [line("Khoản hợp lệ"), line("Người nhận sai", "USER:not-a-member")],
    }), /Người nhận phải là thành viên/);
    assert.equal(await prisma.actualCostSheet.count({ where: { projectId } }), 0, "the first line and sheet creation must roll back");
    assert.equal(await prisma.actualCostLine.count({ where: { projectId } }), 0);

    const saved = await executeActualCostCommand(contributor, {
      command: "SAVE_LINES", projectId, revisionId,
      lines: [line("Thuê loa"), line("Dây tín hiệu", `USER:${contributor.id}`, "120000")],
    });
    assert.equal(saved.lineIds.length, 2);
    const draft = await prisma.actualCostSheetRevision.findFirstOrThrow({ where: { projectId, state: "DRAFT" } });
    assert.equal(draft.revision, 1);
    assert.equal(draft.mutationVersion, 2);
    assert.equal(await prisma.actualCostLine.count({ where: { projectId, draftRemovedAt: null } }), 2);
    assert.equal(await prisma.actualCostApproval.count({ where: { projectId } }), 0, "paste must not approve individual lines");

    await assert.rejects(() => executeActualCostCommand(contributor, {
      command: "SAVE_LINES", projectId, revisionId, sheetRevisionId: draft.id, expectedMutationVersion: 0,
      lines: [line("Bản dán cũ")],
    }), /thay đổi mới/);
    assert.equal(await prisma.actualCostLine.count({ where: { projectId } }), 2, "stale replay writes nothing");

    await assert.rejects(() => executeActualCostCommand(contributor, {
      command: "UPDATE_LINES_STATUS", projectId, lineIds: saved.lineIds,
      internalStatus: "ACCOUNT_REVIEWED", revisionId: draft.id, expectedMutationVersion: draft.mutationVersion,
    }), /Chỉ Account/);
    const reviewed = await executeActualCostCommand(account, {
      command: "UPDATE_LINES_STATUS", projectId, lineIds: saved.lineIds,
      internalStatus: "ACCOUNT_REVIEWED", revisionId: draft.id, expectedMutationVersion: draft.mutationVersion,
    });
    assert.equal(reviewed.count, 2);
    const checkedDraft = await prisma.actualCostSheetRevision.findUniqueOrThrow({ where: { id: draft.id } });
    await assert.rejects(() => executeActualCostCommand(account, {
      command: "SUBMIT_SHEET", projectId, revisionId: draft.id, expectedMutationVersion: checkedDraft.mutationVersion,
      missingEvidenceExplanation: "Chưa có hóa đơn; DD xem xét.",
    }), /vượt Bản IC/);
    await assert.rejects(() => executeActualCostCommand(contributor, {
      command: "SUBMIT_SHEET", projectId, revisionId: draft.id, expectedMutationVersion: checkedDraft.mutationVersion,
      missingEvidenceExplanation: "Chưa có hóa đơn; DD xem xét.",
      overBudgetExplanation: "Giá thực tế tăng.",
    }), /Chỉ Account/);
    await executeActualCostCommand(account, {
      command: "SUBMIT_SHEET", projectId, revisionId: draft.id, expectedMutationVersion: checkedDraft.mutationVersion,
      missingEvidenceExplanation: "Chưa có hóa đơn; DD xem xét.",
      overBudgetExplanation: "Giá thực tế tăng.",
    });
    const submitted = await prisma.actualCostSheetRevision.findUniqueOrThrow({ where: { id: draft.id } });
    assert.equal(submitted.state, "SUBMITTED");
    assert.equal(submitted.submittedById, account.id);
    assert.equal(await prisma.actualCostSheetRevisionLine.count({ where: { revisionId: draft.id } }), 2);
    assert.equal(await prisma.workflowRequest.count({ where: { projectId, kind: "ACTUAL_COST_APPROVAL" } }), 1);
    await assert.rejects(() => executeActualCostCommand(dd, {
      command: "DECIDE_SHEET", projectId, revisionId: draft.id, expectedMutationVersion: submitted.mutationVersion,
      manifestHash: submitted.manifestHash!, action: "APPROVED", reason: "", acknowledgeMissingEvidence: false,
    }), /xác nhận rõ/);
    await assert.rejects(() => executeActualCostCommand(dd, {
      command: "DECIDE_SHEET", projectId, revisionId: draft.id, expectedMutationVersion: submitted.mutationVersion,
      manifestHash: submitted.manifestHash!, action: "RETURNED", reason: "",
    }), /lý do trả lại/);
    await executeActualCostCommand(dd, {
      command: "DECIDE_SHEET", projectId, revisionId: draft.id, expectedMutationVersion: submitted.mutationVersion,
      manifestHash: submitted.manifestHash!, action: "RETURNED", reason: "Bổ sung diễn giải thực chi",
    });
    const returned = await prisma.actualCostSheetRevision.findUniqueOrThrow({ where: { id: draft.id } });
    assert.equal(returned.state, "RETURNED");
    assert.equal(returned.decidedById, dd.id);
    assert.equal(await prisma.actualCostApproval.count({ where: { projectId, action: "RETURNED" } }), 2);
    await assert.rejects(() => executeActualCostCommand(contributor, {
      command: "CREATE_SUCCESSOR", projectId, revisionId: returned.id, expectedMutationVersion: returned.mutationVersion,
    }), /Chỉ Account/);
    const createdSuccessor = await executeActualCostCommand(account, {
      command: "CREATE_SUCCESSOR", projectId, revisionId: returned.id, expectedMutationVersion: returned.mutationVersion,
    });
    await assert.rejects(() => executeActualCostCommand(account, {
      command: "CREATE_SUCCESSOR", projectId, revisionId: returned.id, expectedMutationVersion: returned.mutationVersion,
    }), /thay đổi/);
    const successor = await prisma.actualCostSheetRevision.findUniqueOrThrow({ where: { id: createdSuccessor.revisionId } });
    assert.equal(successor.revision, 2);
    assert.equal(successor.icRevisionId, revisionId);
    await executeActualCostCommand(contributor, {
      command: "SAVE_LINE", projectId, lineId: saved.lineIds[0], sourceKind: "IC_LINKED", revisionId, icLineId,
      recipientKey: `USER:${contributor.id}`, description: "Thuê loa đã giải trình", fundingSource: "EMPLOYEE_OUT_OF_POCKET",
      quantity: "1", days: "1", unitPrice: "110000", unit: "bộ", basis: "NET", vatPercent: "0", evidenceIds: [],
      sheetRevisionId: successor.id, expectedMutationVersion: successor.mutationVersion,
    });
    const editedSuccessor = await prisma.actualCostSheetRevision.findUniqueOrThrow({ where: { id: successor.id } });
    assert.equal((await prisma.actualCostSheetRevision.findUniqueOrThrow({ where: { id: draft.id } })).manifestHash, submitted.manifestHash, "the returned manifest stays immutable");
    await executeActualCostCommand(account, {
      command: "UPDATE_LINES_STATUS", projectId, lineIds: saved.lineIds,
      internalStatus: "ACCOUNT_REVIEWED", revisionId: successor.id, expectedMutationVersion: editedSuccessor.mutationVersion,
    });
    const reviewedSuccessor = await prisma.actualCostSheetRevision.findUniqueOrThrow({ where: { id: successor.id } });
    await executeActualCostCommand(account, {
      command: "SUBMIT_SHEET", projectId, revisionId: successor.id, expectedMutationVersion: reviewedSuccessor.mutationVersion,
      missingEvidenceExplanation: "DD xem xét khi còn thiếu hóa đơn.",
      overBudgetExplanation: "Giá thực tế tăng; đã giải trình.",
    });
    const submittedSuccessor = await prisma.actualCostSheetRevision.findUniqueOrThrow({ where: { id: successor.id } });
    assert.notEqual(submittedSuccessor.manifestHash, submitted.manifestHash);
    await executeActualCostCommand(dd, {
      command: "DECIDE_SHEET", projectId, revisionId: successor.id, expectedMutationVersion: submittedSuccessor.mutationVersion,
      manifestHash: submittedSuccessor.manifestHash!, action: "APPROVED", reason: "Đã xem giải trình", acknowledgeMissingEvidence: true,
    });
    const approved = await prisma.actualCostSheetRevision.findUniqueOrThrow({ where: { id: successor.id } });
    assert.equal(approved.state, "APPROVED");
    assert.equal(approved.decidedById, dd.id);
    assert.notEqual(approved.submittedById, approved.decidedById);
    assert.equal(await prisma.actualCostApproval.count({ where: { projectId, action: "APPROVED" } }), 2);
    assert.equal(await prisma.workflowRequest.count({ where: { projectId, kind: "ACTUAL_COST_APPROVAL" } }), 2);
    await assert.rejects(() => executeActualCostCommand(dd, {
      command: "DECIDE_SHEET", projectId, revisionId: draft.id, expectedMutationVersion: submitted.mutationVersion,
      manifestHash: submitted.manifestHash!, action: "APPROVED", reason: "Replay", acknowledgeMissingEvidence: true,
    }), /không còn chờ duyệt/);
  } finally {
    if (projectId) {
      const sheet = await prisma.actualCostSheet.findUnique({ where: { projectId }, select: { id: true } });
      const workflowRequestIds = (await prisma.workflowRequest.findMany({ where: { projectId, kind: "ACTUAL_COST_APPROVAL" }, select: { id: true } })).map(item => item.id);
      await prisma.actualCostSheetEvent.deleteMany({ where: { projectId } });
      await prisma.actualCostSheetRevisionLine.deleteMany({ where: { projectId } });
      await prisma.actualCostApproval.deleteMany({ where: { projectId } });
      await prisma.actualCostFundingAllocation.deleteMany({ where: { projectId } });
      await prisma.actualCostEvidenceLink.deleteMany({ where: { projectId } });
      await prisma.actualCostVersion.deleteMany({ where: { projectId } });
      await prisma.actualCostLine.deleteMany({ where: { projectId } });
      await prisma.actualCostSheetRevision.deleteMany({ where: { projectId } });
      if (sheet) await prisma.actualCostSheet.delete({ where: { id: sheet.id } });
      if (workflowRequestIds.length) await prisma.workflowRequest.deleteMany({ where: { id: { in: workflowRequestIds }, projectId } });
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId, name: prefix } });
    }
    if (userIds.length) await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    if (userIds.length) await prisma.workflowRoleGrant.deleteMany({ where: { userId: { in: userIds }, role: "AC_DD" } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds }, email: { startsWith: prefix } } });
    await prisma.$disconnect();
  }
});
