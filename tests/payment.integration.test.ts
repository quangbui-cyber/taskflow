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

test("payment-integration: service creates one canonical 75m dossier with zero cash", async () => {
  approvedDatabaseUrl();
  const { prisma } = await import("../lib/prisma");
  const { executeFinance, loadFinance } = await import("../lib/costflow/service");
  const { calculateCost } = await import("../lib/costflow/money");
  const { emptyFinance } = await import("../lib/costflow/types");
  const prefix = `phase7-service-${randomUUID()}`;
  const createdUserIds: string[] = [];
  let projectId = "";
  try {
    const createUser = async (label: string, role = "USER", managerId?: string) => {
      const user = await prisma.user.create({ data: { email: `${prefix}-${label}@example.test`, name: `${prefix} ${label}`, role, managerId, passwordHash: "unused" } });
      createdUserIds.push(user.id);
      return user;
    };
    const manager = await createUser("manager");
    const account = await createUser("account", "ACCOUNT", manager.id);
    const accountant = await createUser("accountant");
    const ceo = await createUser("ceo");
    const employee = await createUser("employee");
    const project = await prisma.project.create({ data: { name: prefix, ownerId: account.id, members: { create: [account, manager, accountant, ceo, employee].map(user => ({ userId: user.id })) } } });
    projectId = project.id;
    const vendorAProof = await prisma.costFlowEvidence.create({ data: { projectId, sourceFileId: `${prefix}-proof-a`, kind: "BENEFICIARY", name: "vendor-a-proof.pdf", mimeType: "application/pdf", data: Buffer.from("vendor-a-v1"), sha256: "vendor-a-v1", createdBy: account.id } });
    const vendorBProof = await prisma.costFlowEvidence.create({ data: { projectId, sourceFileId: `${prefix}-proof-b`, kind: "BENEFICIARY", name: "vendor-b-proof.pdf", mimeType: "application/pdf", data: Buffer.from("vendor-b-v1"), sha256: "vendor-b-v1", createdBy: account.id } });
    const finance = emptyFinance();
    finance.config = { managerId: manager.id, accountantId: accountant.id, ceoId: ceo.id };
    finance.beneficiaries = [
      { id: `${prefix}-vendor-a`, name: "Vendor A", bank: "Bank A", account: "00001111", version: 1, verifiedVersion: null, proofId: vendorAProof.id },
      { id: `${prefix}-resort-b`, name: "Resort B", bank: "Bank B", account: "00002222", version: 1, verifiedVersion: null, proofId: vendorBProof.id },
    ];
    const makeLine = (id: string, description: string, gross: string) => ({ id, description, unit: "gói", quantity: "1", unitPrice: gross, basis: "GROSS" as const, vatPercent: "0", cost: calculateCost({ quantity: "1", unitPrice: gross, basis: "GROSS", vatPercent: "0" }) });
    finance.revisions = [{ id: `${prefix}-revision`, number: 1, requestId: `${prefix}-ic-request`, effective: true, lines: [makeLine("line-a", "Vendor A", "25000000"), makeLine("line-b", "Resort B", "40000000"), makeLine("line-c", "Vận hành", "10000000")], poIds: [], evidenceIds: [], createdBy: account.id }];
    await prisma.costFlowWorkspace.create({ data: { projectId, data: finance } });

    const form = new FormData();
    form.set("command", "CREATE_PAYMENT_DOSSIER");
    form.set("kind", "ADVANCE");
    form.set("title", "ĐNTU 75m đa người nhận");
    form.set("milestone", "Đợt chuẩn bị và đặt cọc trước sự kiện");
    form.set("explanation", "Ba khoản theo IC hiệu lực");
    form.set("clientTotal", "1");
    form.set("lines", JSON.stringify([
      { stableKey: "vendor-a", description: "Đặt cọc Vendor A", amount: "25000000", revisionId: `${prefix}-revision`, lineId: "line-a", recipientKey: `VENDOR:${prefix}-vendor-a`, evidenceIds: [] },
      { stableKey: "resort-b", description: "Đặt cọc Resort B", amount: "40000000", revisionId: `${prefix}-revision`, lineId: "line-b", recipientKey: `VENDOR:${prefix}-resort-b`, evidenceIds: [] },
      { stableKey: "employee", description: "Tạm ứng vận hành", amount: "10000000", revisionId: `${prefix}-revision`, lineId: "line-c", recipientKey: `USER:${employee.id}`, evidenceIds: [] },
    ]));
    const result = await executeFinance(projectId, 0, account, form, null);
    assert.ok(result.requestId);
    const request = await prisma.workflowRequest.findUniqueOrThrow({ where: { id: result.requestId }, include: { paymentLines: { orderBy: { position: "asc" } }, paymentRecipients: true, cash: true } });
    const payload = request.payload as Record<string, unknown>;
    assert.equal(request.kind, "ADVANCE");
    assert.equal(payload.amount, "75000000");
    assert.equal(request.paymentLines.length, 3);
    assert.deepEqual(request.paymentLines.map(line => line.amount), ["25000000", "40000000", "10000000"]);
    assert.deepEqual(Object.fromEntries(request.paymentRecipients.map(item => [item.recipientKey, item.totalAmount])), { [`VENDOR:${prefix}-vendor-a`]: "25000000", [`VENDOR:${prefix}-resort-b`]: "40000000", [`USER:${employee.id}`]: "10000000" });
    assert.equal(request.cash.length, 0);
    const reloaded = await loadFinance(projectId, account);
    assert.equal(reloaded?.paymentDossiers[0]?.totalAmount, "75000000");
    assert.equal(reloaded?.paymentDossiers[0]?.lines.length, 3);

    let workspaceVersion = 1;
    const requestToken = async (id: string) => {
      const saved = await prisma.workflowRequest.findUniqueOrThrow({ where: { id }, include: { approvalEvents: { orderBy: { createdAt: "asc" } } } });
      const submitted = saved.approvalEvents.find(event => event.action === "SUBMIT" && event.attemptId === saved.currentAttemptId);
      assert.ok(submitted);
      return { request: saved, submittedVersion: submitted.submittedVersion };
    };
    const decideForm = async (id: string, decision: "APPROVE" | "RETURN" | "REJECT", overrides: { attemptId?: string; reason?: string } = {}) => {
      const token = await requestToken(id);
      const decisionForm = new FormData();
      decisionForm.set("command", "DECIDE");
      decisionForm.set("requestId", id);
      decisionForm.set("module", token.request.module);
      decisionForm.set("attemptId", overrides.attemptId ?? token.request.currentAttemptId ?? "");
      decisionForm.set("stepIndex", String(token.request.currentStep));
      decisionForm.set("submittedVersion", String(token.submittedVersion));
      decisionForm.set("decision", decision);
      decisionForm.set("reason", overrides.reason ?? (decision === "APPROVE" ? "Đạt" : "Cần sửa thông tin NCC"));
      if (decision === "RETURN") decisionForm.append("correctionItems", "Cập nhật thông tin và căn cứ NCC");
      if (token.request.currentStep === 1) decisionForm.set("reviewConfirmed", "yes");
      return decisionForm;
    };

    const firstLine = request.paymentLines[0];
    const invalidMention = new FormData();
    invalidMention.set("command", "ADD_PAYMENT_LINE_DISCUSSION");
    invalidMention.set("requestId", request.id);
    invalidMention.set("lineId", firstLine.id);
    invalidMention.set("body", "Không được nhắc người ngoài Project");
    invalidMention.set("mentionIds", JSON.stringify([randomUUID()]));
    await assert.rejects(() => executeFinance(projectId, workspaceVersion, manager, invalidMention, null), /thành viên đang hoạt động/i);
    assert.equal(await prisma.paymentLineDiscussion.count({ where: { requestId: request.id } }), 0);

    const discussion = new FormData();
    discussion.set("command", "ADD_PAYMENT_LINE_DISCUSSION");
    discussion.set("requestId", request.id);
    discussion.set("lineId", firstLine.id);
    discussion.set("body", "Vui lòng đối chiếu đúng bản báo giá NCC.");
    discussion.set("mentionIds", JSON.stringify([account.id]));
    await executeFinance(projectId, workspaceVersion, manager, discussion, null);
    workspaceVersion += 1;
    assert.equal(await prisma.paymentLineDiscussion.count({ where: { requestId: request.id } }), 1);
    assert.equal(await prisma.workflowDecision.count({ where: { requestId: request.id } }), 0);

    await assert.rejects(() => decideForm(request.id, "APPROVE", { attemptId: randomUUID() }).then(stale => executeFinance(projectId, workspaceVersion, manager, stale, null)), /bước duyệt đã thay đổi/i);
    assert.equal(await prisma.workflowDecision.count({ where: { requestId: request.id } }), 0);
    await executeFinance(projectId, workspaceVersion, manager, await decideForm(request.id, "APPROVE"), null);
    workspaceVersion += 1;

    const vendorAProofV2 = await prisma.costFlowEvidence.create({ data: { projectId, sourceFileId: `${prefix}-proof-a-v2`, kind: "BENEFICIARY", name: "vendor-a-proof-v2.pdf", mimeType: "application/pdf", data: Buffer.from("vendor-a-v2"), sha256: "vendor-a-v2", createdBy: account.id } });
    const workspace = await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId } });
    const changedFinance = structuredClone(workspace.data) as typeof finance;
    const changedVendor = changedFinance.beneficiaries.find(beneficiary => beneficiary.id === `${prefix}-vendor-a`)!;
    changedVendor.version = 2;
    changedVendor.proofId = vendorAProofV2.id;
    await prisma.costFlowWorkspace.update({ where: { projectId }, data: { data: changedFinance, version: { increment: 1 } } });
    workspaceVersion += 1;

    const beforeFailedApproval = {
      decisions: await prisma.workflowDecision.count({ where: { requestId: request.id } }),
      events: await prisma.workflowApprovalEvent.count({ where: { requestId: request.id } }),
      cash: await prisma.costFlowCash.count({ where: { projectId } }),
    };
    await assert.rejects(() => decideForm(request.id, "APPROVE").then(staleVendor => executeFinance(projectId, workspaceVersion, accountant, staleVendor, null)), /NCC đã đổi thông tin/i);
    assert.deepEqual({
      decisions: await prisma.workflowDecision.count({ where: { requestId: request.id } }),
      events: await prisma.workflowApprovalEvent.count({ where: { requestId: request.id } }),
      cash: await prisma.costFlowCash.count({ where: { projectId } }),
    }, beforeFailedApproval);

    await executeFinance(projectId, workspaceVersion, accountant, await decideForm(request.id, "RETURN"), null);
    workspaceVersion += 1;
    const correction = await prisma.workflowRequest.findFirstOrThrow({ where: { parentId: request.id, state: "DRAFT" }, include: { paymentLines: { orderBy: { position: "asc" } } } });
    assert.equal(correction.paymentLines.length, 3);
    assert.deepEqual((await prisma.paymentRequestLine.findMany({ where: { requestId: request.id }, orderBy: { position: "asc" } })).map(line => [line.stableKey, line.amount]), [["vendor-a", "25000000"], ["resort-b", "40000000"], ["employee", "10000000"]]);

    const resubmit = new FormData();
    resubmit.set("command", "RESUBMIT_PAYMENT_DOSSIER");
    resubmit.set("requestId", correction.id);
    resubmit.set("kind", "ADVANCE");
    resubmit.set("title", "ĐNTU 77m đa người nhận · bản sửa");
    resubmit.set("milestone", "Đợt chuẩn bị và đặt cọc đã cập nhật");
    resubmit.set("explanation", "Đã cập nhật thông tin và căn cứ Vendor A");
    resubmit.set("lines", JSON.stringify([
      { stableKey: "vendor-a", description: "Đặt cọc Vendor A bản sửa", amount: "27000000", revisionId: `${prefix}-revision`, lineId: "line-a", recipientKey: `VENDOR:${prefix}-vendor-a`, evidenceIds: [] },
      { stableKey: "resort-b", description: "Đặt cọc Resort B", amount: "40000000", revisionId: `${prefix}-revision`, lineId: "line-b", recipientKey: `VENDOR:${prefix}-resort-b`, evidenceIds: [] },
      { stableKey: "employee", description: "Tạm ứng vận hành", amount: "10000000", revisionId: `${prefix}-revision`, lineId: "line-c", recipientKey: `USER:${employee.id}`, evidenceIds: [] },
    ]));
    await executeFinance(projectId, workspaceVersion, account, resubmit, null);
    workspaceVersion += 1;
    const resubmitted = await prisma.workflowRequest.findUniqueOrThrow({ where: { id: correction.id } });
    assert.equal(resubmitted.state, "SUBMITTED");
    assert.equal((resubmitted.payload as { amount: string }).amount, "77000000");
    assert.equal(((resubmitted.payload as { diff: { changed: boolean; totals: { before: string; after: string } } }).diff).changed, true);
    assert.deepEqual((resubmitted.payload as { diff: { totals: { before: string; after: string } } }).diff.totals, { before: "75000000", after: "77000000" });

    await executeFinance(projectId, workspaceVersion, manager, await decideForm(correction.id, "APPROVE"), null);
    workspaceVersion += 1;
    await executeFinance(projectId, workspaceVersion, accountant, await decideForm(correction.id, "APPROVE"), null);
    workspaceVersion += 1;
    const accountantEvent = await prisma.workflowApprovalEvent.findFirstOrThrow({ where: { requestId: correction.id, action: "APPROVE", role: "ACCOUNTANT" } });
    assert.equal(((accountantEvent.details as { vendorChecks: unknown[] }).vendorChecks).length, 2);
    await executeFinance(projectId, workspaceVersion, ceo, await decideForm(correction.id, "APPROVE"), null);
    workspaceVersion += 1;
    assert.equal((await prisma.workflowRequest.findUniqueOrThrow({ where: { id: correction.id } })).state, "APPROVED");
    assert.equal(await prisma.costFlowCash.count({ where: { projectId } }), 0);
    assert.equal(workspaceVersion, 9);
  } finally {
    if (projectId) {
      await prisma.costFlowCashAllocation.deleteMany({ where: { projectId } });
      await prisma.costFlowCash.deleteMany({ where: { projectId } });
      await prisma.paymentLineDiscussion.deleteMany({ where: { projectId } });
      await prisma.advanceApplication.deleteMany({ where: { projectId } });
      await prisma.paymentRequestLine.deleteMany({ where: { projectId } });
      await prisma.paymentRecipientSnapshot.deleteMany({ where: { projectId } });
      await prisma.workflowNotificationDelivery.deleteMany({ where: { event: { request: { projectId } } } });
      await prisma.workflowApprovalEvent.deleteMany({ where: { request: { projectId } } });
      await prisma.workflowRequestReader.deleteMany({ where: { request: { projectId } } });
      await prisma.workflowDecision.deleteMany({ where: { request: { projectId } } });
      await prisma.workflowRequest.deleteMany({ where: { projectId } });
      await prisma.costFlowHistory.deleteMany({ where: { projectId } });
      await prisma.costFlowEvidence.deleteMany({ where: { projectId } });
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId, name: prefix } });
    }
    if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds }, email: { startsWith: prefix } } });
  }
});
