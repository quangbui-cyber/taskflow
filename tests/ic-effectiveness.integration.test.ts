import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FinanceData } from "../lib/costflow/types";

test("Phase 6 IC effect, CEO outcomes and linked recovery persist on the approved local database", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Phase 6 test requires PostgreSQL");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "Phase 6 test refuses non-local hosts");
  assert.equal(url.port, "55439", "Phase 6 test only uses port 55439");
  assert.equal(url.pathname, "/taskflow", "Phase 6 test only uses database taskflow");

  const { prisma } = await import("../lib/prisma");
  const { executeFinance } = await import("../lib/costflow/service");
  const prefix = `phase6-${randomUUID()}`;
  const createdUserIds: string[] = [];
  let projectId = "";
  try {
    const createUser = async (label: string, role: string, managerId?: string) => {
      const user = await prisma.user.create({ data: { email: `${prefix}-${label}@example.test`, name: `Phase 6 ${label}`, role, managerId, passwordHash: "unused" } });
      createdUserIds.push(user.id);
      return user;
    };
    const manager = await createUser("manager", "USER");
    const account = await createUser("account", "ACCOUNT", manager.id);
    const accountant = await createUser("accountant", "USER");
    const ceo = await createUser("ceo", "USER");
    const admin = await createUser("admin", "ADMIN", manager.id);
    const project = await prisma.project.create({ data: { name: prefix, ownerId: account.id, members: { create: [account, manager, accountant, ceo].map(user => ({ userId: user.id })) } } });
    projectId = project.id;

    const version = async () => (await prisma.costFlowWorkspace.findUnique({ where: { projectId } }))?.version ?? 0;
    const state = async () => (await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId } })).data as unknown as FinanceData;
    const act = async (actor: { id: string; role: string }, command: string, fields: Record<string, string> = {}, expected?: number) => {
      const form = new FormData();
      form.set("command", command);
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      if (command === "DECIDE" && fields.requestId) {
        const request = await prisma.workflowRequest.findUniqueOrThrow({ where: { id: fields.requestId } });
        const submitted = await prisma.workflowApprovalEvent.findFirst({ where: { requestId: request.id, attemptId: request.currentAttemptId, action: "SUBMIT" }, orderBy: { createdAt: "desc" } });
        form.set("module", request.module);
        form.set("attemptId", request.currentAttemptId ?? "");
        form.set("stepIndex", String(request.currentStep));
        form.set("submittedVersion", String(submitted?.submittedVersion ?? ""));
        if (fields.decision === "APPROVE") form.set("reviewConfirmed", "yes");
      }
      return executeFinance(projectId, expected ?? await version(), actor, form, null);
    };

    await act(admin, "CONFIGURE", { accountantId: accountant.id, ceoId: ceo.id, managerId: manager.id });
    await act(account, "SAVE_IC", { title: "IC Phase 6", lines: JSON.stringify([{ description: "Sản xuất", unit: "gói", quantity: "1", unitPrice: "1000000", basis: "NET", vatPercent: "8", evidenceReason: "Synthetic Phase 6 estimate" }]) });
    const first = (await state()).revisions[0];
    await assert.rejects(act(account, "SUBMIT", { requestId: first.requestId, explanation: "   " }), /lý do|tóm tắt/);
    await act(account, "SUBMIT", { requestId: first.requestId, explanation: "  Điều chỉnh giá sản xuất  " });
    const submittedState = await state();
    assert.equal(submittedState.revisions[0].submissions?.[0].explanation, "Điều chỉnh giá sản xuất");
    assert.equal(submittedState.revisions[0].submissions?.[0].baselineRevisionId, null);
    const submitEvent = await prisma.workflowApprovalEvent.findFirstOrThrow({ where: { requestId: first.requestId, action: "SUBMIT" } });
    assert.equal(submitEvent.reason, "Điều chỉnh giá sản xuất");

    const managerVersion = await version();
    const race = await Promise.allSettled([
      act(manager, "DECIDE", { requestId: first.requestId, decision: "APPROVE" }, managerVersion),
      act(manager, "DECIDE", { requestId: first.requestId, decision: "APPROVE" }, managerVersion),
    ]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.deepEqual((await state()).revisions.filter(revision => revision.effective).map(revision => revision.id), [first.id]);
    let request = await prisma.workflowRequest.findUniqueOrThrow({ where: { id: first.requestId } });
    assert.equal(request.currentStep, 1);
    const managerEvent = await prisma.workflowApprovalEvent.findFirstOrThrow({ where: { requestId: first.requestId, action: "APPROVE", stepIndex: 0 }, include: { deliveries: true } });
    assert.deepEqual(managerEvent.deliveries.map(item => item.userId), [accountant.id]);

    await act(accountant, "DECIDE", { requestId: first.requestId, decision: "APPROVE" });
    await act(ceo, "DECIDE", { requestId: first.requestId, decision: "REJECT", reason: "" });
    assert.equal((await state()).revisions.find(revision => revision.id === first.id)?.effective, true);
    const ceoEvent = await prisma.workflowApprovalEvent.findFirstOrThrow({ where: { requestId: first.requestId, action: "REJECT" }, include: { deliveries: true } });
    assert.deepEqual(new Set(ceoEvent.deliveries.map(item => item.userId)), new Set([account.id, manager.id, accountant.id]));
    assert.equal(ceoEvent.reason, "");

    await act(manager, "IC_MANAGER_EXPLANATION", { requestId: first.requestId, explanation: "Quản lý xác nhận baseline vẫn dùng trong lúc xử lý tiếp." });
    const explanationEvent = await prisma.workflowApprovalEvent.findFirstOrThrow({ where: { requestId: first.requestId, action: "IC_MANAGER_EXPLANATION" } });
    assert.equal(explanationEvent.actorId, manager.id);
    assert.equal((await state()).revisions.find(revision => revision.id === first.id)?.effective, true);

    await act(account, "CREATE_REQUEST", { kind: "CANCEL", title: "Hủy IC bị CEO từ chối", targetRequestId: first.requestId, explanation: "Ngừng baseline để làm lại" });
    const cancel = await prisma.workflowRequest.findFirstOrThrow({ where: { projectId, kind: "CANCEL" }, orderBy: { createdAt: "desc" } });
    await act(manager, "DECIDE", { requestId: cancel.id, decision: "APPROVE" });
    assert.equal((await state()).revisions.filter(revision => revision.effective).length, 0);
    request = await prisma.workflowRequest.findUniqueOrThrow({ where: { id: first.requestId } });
    assert.equal(request.state, "CANCELLED");
    await assert.rejects(act(account, "CREATE_REQUEST", { kind: "ADVANCE", title: "Forged old baseline", recipientKey: `USER:${account.id}`, revisionId: first.id, amount: "1" }), /IC đang có hiệu lực/);

    await act(account, "COPY_IC", { sourceRevisionId: first.id, title: "IC phục hồi liên kết", explanation: "Ngừng baseline để làm lại" });
    const recovery = (await state()).revisions.at(-1)!;
    assert.equal(recovery.parentRevisionId, first.id);
    assert.equal(recovery.lineageReason, "Ngừng baseline để làm lại");
    assert.equal(recovery.effective, false);
    await act(account, "SUBMIT", { requestId: recovery.requestId, explanation: "Gửi lại sau hủy" });
    await act(manager, "DECIDE", { requestId: recovery.requestId, decision: "APPROVE" });
    await act(accountant, "DECIDE", { requestId: recovery.requestId, decision: "APPROVE" });
    await act(ceo, "DECIDE", { requestId: recovery.requestId, decision: "RETURN", reason: "" });
    const finalState = await state();
    const linkedDrafts = finalState.revisions.filter(revision => revision.parentRevisionId === recovery.id);
    assert.equal(linkedDrafts.length, 1);
    assert.equal(linkedDrafts[0].effective, false);
    assert.equal(finalState.revisions.find(revision => revision.id === recovery.id)?.effective, true);
    const correctionRequest = await prisma.workflowRequest.findUniqueOrThrow({ where: { id: linkedDrafts[0].requestId } });
    assert.equal(correctionRequest.state, "DRAFT");
    assert.equal(correctionRequest.parentId, recovery.requestId);

    console.log(JSON.stringify({ phase: 6, database: url.pathname, projectId, firstRequestId: first.requestId, firstRevisionId: first.id, cancelRequestId: cancel.id, recoveryRequestId: recovery.requestId, recoveryRevisionId: recovery.id, correctionRequestId: correctionRequest.id, correctionRevisionId: linkedDrafts[0].id, submitEventId: submitEvent.id, managerEventId: managerEvent.id, ceoEventId: ceoEvent.id, explanationEventId: explanationEvent.id }));
  } finally {
    if (projectId) {
      await prisma.costFlowCash.deleteMany({ where: { projectId } });
      await prisma.workflowNotificationDelivery.deleteMany({ where: { event: { request: { projectId } } } });
      await prisma.workflowApprovalEvent.deleteMany({ where: { request: { projectId } } });
      await prisma.workflowRequestReader.deleteMany({ where: { request: { projectId } } });
      await prisma.workflowDecision.deleteMany({ where: { request: { projectId } } });
      await prisma.workflowRequest.deleteMany({ where: { projectId } });
      await prisma.costFlowHistory.deleteMany({ where: { projectId } });
      await prisma.costFlowEvidence.deleteMany({ where: { projectId } });
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  }
});
