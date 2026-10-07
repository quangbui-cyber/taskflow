import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test("Workflow inbox provenance, exact step and concurrent decision persist atomically", { skip: !process.env.COSTFLOW_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.COSTFLOW_TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/costflow_test");
  process.env.DATABASE_URL = process.env.COSTFLOW_TEST_DATABASE_URL;
  const { prisma } = await import("../lib/prisma");
  const { executeWorkflow, loadWorkflow } = await import("../lib/workflow/service");
  const prefix = `approval-${randomUUID()}`;
  const createUser = (label: string, managerId?: string) => prisma.user.create({ data: { email: `${prefix}-${label}@example.test`, name: label, passwordHash: "test", managerId } });
  const action = async (actor: { id: string; role: string }, command: string, fields: Record<string,string>) => {
    const form = new FormData(); form.set("command", command);
    for (const [key,value] of Object.entries(fields)) form.set(key,value);
    return executeWorkflow(actor, form, null);
  };
  try {
    const manager = await createUser("Manager");
    const creator = await createUser("Creator", manager.id);
    const accountant = await createUser("Accountant");
    const ceo = await createUser("CEO");
    const attemptId = randomUUID();
    const request = await prisma.workflowRequest.create({ data: {
      module: "WORKFLOW", kind: "PROPOSAL", title: "Approval provenance",
      creatorId: creator.id, cashAssigneeId: creator.id, state: "SUBMITTED",
      steps: [{role:"MANAGER",assigneeId:manager.id},{role:"ACCOUNTANT",assigneeId:accountant.id},{role:"CEO",assigneeId:ceo.id}],
      currentStep: 0, currentAttemptId: attemptId, currentStepArrivedAt: new Date(), payload: {},
    } });
    await prisma.workflowApprovalEvent.create({ data: {
      requestId: request.id, module: request.module, attemptId, submittedVersion: request.version,
      mutationVersion: request.version, stepIndex: 0, role: "MANAGER", actorId: creator.id,
      action: "SUBMIT_DOCUMENT",
    } });
    const managerInbox = await loadWorkflow(manager);
    assert.equal(managerInbox.views.pending.some(row => row.id === request.id), true);
    const fields = { requestId: request.id, version: String(request.version), decision: "APPROVE", module: request.module, attemptId, stepIndex: "0", submittedVersion: String(request.version) };
    const concurrent = await Promise.allSettled([action(manager,"DECIDE_DOCUMENT",fields), action(manager,"DECIDE_DOCUMENT",fields)]);
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
    const saved = await prisma.workflowRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(saved.currentStep, 1);
    assert.equal(saved.currentAttemptId, attemptId);
    assert.ok(saved.currentStepArrivedAt);
    assert.equal(await prisma.workflowDecision.count({ where: { requestId: request.id } }), 1);
    assert.equal(await prisma.workflowApprovalEvent.count({ where: { requestId: request.id, action: "APPROVE" } }), 1);
    assert.equal((await loadWorkflow(accountant)).views.pending.some(row => row.id === request.id), true);
    assert.equal((await loadWorkflow(manager)).views.processed.some(row => row.id === request.id), true);
  } finally {
    await prisma.workflowNotificationDelivery.deleteMany({ where: { event: { request: { title: "Approval provenance" } } } }).catch(()=>undefined);
    await prisma.workflowApprovalEvent.deleteMany({ where: { request: { title: "Approval provenance" } } }).catch(()=>undefined);
    await prisma.workflowDecision.deleteMany({ where: { request: { title: "Approval provenance" } } }).catch(()=>undefined);
    await prisma.workflowHistory.deleteMany({ where: { request: { title: "Approval provenance" } } }).catch(()=>undefined);
    await prisma.workflowRequest.deleteMany({ where: { title: "Approval provenance" } }).catch(()=>undefined);
    await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } }).catch(()=>undefined);
    await prisma.$disconnect();
  }
});
