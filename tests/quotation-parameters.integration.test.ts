import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { FinanceData, PairedRow } from "../lib/costflow/types";
import type { QuotationParameterSnapshot } from "../lib/costflow/quotationParameters";

const config = (participants: string): QuotationParameterSnapshot => ({
  schemaVersion: 1,
  definitions: [{ key: "participants", label: "Số người", defaultValue: participants, scope: "SHARED" }],
  sharedValues: { participants },
  modules: [{ id: "module", label: "Mixed event", eventType: "Custom mixed", overrides: {} }],
});

test("parameter snapshots survive template drift, CAS, finalization, submit and revision copy", { skip: !process.env.COSTFLOW_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.COSTFLOW_TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/costflow_test");
  process.env.DATABASE_URL = url.href;
  const { prisma } = await import("../lib/prisma");
  const { executeFinance } = await import("../lib/costflow/service");
  const prefix = `params-${randomUUID()}`;
  const userIds: string[] = [];
  try {
    const manager = await prisma.user.create({ data: { name: "Parameter Manager", email: `${prefix}-manager@example.test`, role: "USER", passwordHash: "unused" } });
    const account = await prisma.user.create({ data: { name: "Parameter Account", email: `${prefix}-account@example.test`, role: "ACCOUNT", passwordHash: "unused", managerId: manager.id } });
    const admin = await prisma.user.create({ data: { name: "Parameter Admin", email: `${prefix}-admin@example.test`, role: "ADMIN", passwordHash: "unused" } });
    userIds.push(manager.id, account.id, admin.id);
    const client = await prisma.client.create({ data: { name: `${prefix}-client` } });
    const project = await prisma.project.create({ data: { name: "Parameter fixture", ownerId: account.id, clientId: client.id, revenue: 731, members: { create: { userId: account.id } } } });
    const estimateBytes = Buffer.from(`${prefix}:estimate`);
    const estimate = await prisma.costFlowEvidence.create({ data: {
      projectId: project.id, sourceFileId: "", kind: "IC_ESTIMATE", name: "estimate.txt", mimeType: "text/plain",
      data: estimateBytes, sha256: createHash("sha256").update(estimateBytes).digest("hex"), createdBy: account.id,
    } });
    const sourceRow = {
      itemId: "source-item", parentItemId: null, rowType: "ITEM", name: "Delegate package", description: "", pricingMode: "DETAIL", showChildren: true, showGroupSubtotal: true, packageChildDisplay: "CONTENT",
      sell: { unit: "Người", quantity: "10", days: "1", unitPrice: "100", vatPercent: "0", basis: "NET", notes: "", parameterBinding: { mode: "PARAMETER", moduleId: "module", quantityFormula: { op: "PARAM", key: "participants" }, lastCalculated: { quantity: "10" } } },
    };
    const template = await prisma.quotationTemplate.create({ data: { name: `${prefix}-template`, description: "parameter fixture", createdBy: admin.id, snapshot: JSON.parse(JSON.stringify({ parameterConfig: config("10"), notes: "", rows: [sourceRow], totalLines: [], totalLayout: [] })) } });
    const state = async () => (await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: project.id } })).data as unknown as FinanceData;
    const version = async () => (await prisma.costFlowWorkspace.findUnique({ where: { projectId: project.id } }))?.version ?? 0;
    const act = async (command: string, fields: Record<string, string> = {}, actor = account, expected?: number) => {
      const form = new FormData(); form.set("command", command);
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      return executeFinance(project.id, expected ?? await version(), actor, form, null);
    };
    await act("CONFIGURE", { managerId: manager.id, accountantId: manager.id, ceoId: manager.id }, admin);
    const created = await act("CREATE_REUSE_DRAFT", { reuseKind: "TEMPLATE", reuseSourceId: template.id, workspaceMode: "paired" });
    await prisma.quotationTemplate.update({ where: { id: template.id }, data: { snapshot: JSON.parse(JSON.stringify({ parameterConfig: config("999"), notes: "changed", rows: [sourceRow], totalLines: [], totalLayout: [] })) } });
    let draft = (await state()).quotationDrafts!.find(item => item.id === created.draftId)!;
    assert.equal(draft.parameterConfig!.sharedValues.participants, "10");
    assert.equal(draft.notes, "");

    const row = structuredClone(draft.rows[0]);
    row.buy = { ...row.buy, unit: "Người", quantity: "10", days: "1", unitPrice: "60", vatPercent: "0", evidenceIds: [estimate.id], evidenceReason: "Supplier estimate pending", parameterBinding: { mode: "PARAMETER", moduleId: "module", quantityFormula: { op: "PARAM", key: "participants" }, lastCalculated: { quantity: "10" } } };
    const baseFields = (rows: PairedRow[], parameterConfig: QuotationParameterSnapshot) => ({ draftId: draft.id, workspaceMode: "paired", title: "Parameterized quote", clientId: client.id, rows: JSON.stringify(rows), parameterConfig: JSON.stringify(parameterConfig), globalEvidenceIds: "[]", totalLines: "[]", totalLayout: "[]" });
    const missing = config("");
    await act("SAVE_PAIRED_DRAFT", baseFields([row], missing));
    await assert.rejects(() => act("FINALIZE_PAIRED_QUOTATION", baseFields([row], missing)), /Delegate package: Thiếu giá trị tham số/);
    assert.equal((await state()).quotations!.length, 0);

    const corrected = config("12");
    row.sell.quantity = "12"; row.sell.parameterBinding!.lastCalculated = { quantity: "12" };
    row.buy.quantity = "12"; row.buy.parameterBinding!.lastCalculated = { quantity: "12" };
    const finalized = await act("FINALIZE_PAIRED_QUOTATION", baseFields([row], corrected));
    let data = await state();
    const quote = data.quotations!.find(item => item.id === finalized.quotationId)!;
    const quoteFrozen = structuredClone(quote);
    const revision = data.revisions.find(item => item.id === finalized.revisionId)!;
    assert.equal(quote.parameterConfig!.sharedValues.participants, "12");
    assert.equal(revision.parameterConfig!.sharedValues.participants, "12");

    const raceVersion = await version();
    const race = await Promise.allSettled([
      act("SAVE_PAIRED_DRAFT", baseFields([row], corrected), account, raceVersion),
      act("SAVE_PAIRED_DRAFT", baseFields([row], corrected), account, raceVersion),
    ]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await version(), raceVersion + 1);

    await act("SUBMIT", { requestId: revision.requestId, explanation: "Submit parameterized IC" });
    data = await state();
    const submitted = data.revisions.find(item => item.id === revision.id)!;
    assert.equal(submitted.submissions!.at(-1)!.parameterConfig!.sharedValues.participants, "12");
    const submittedFrozen = structuredClone(submitted);
    draft = data.quotationDrafts!.find(item => item.id === draft.id)!;
    const changed = config("20");
    const changedRow = structuredClone(draft.rows[0]); changedRow.sell.quantity = "20"; changedRow.sell.parameterBinding!.lastCalculated = { quantity: "20" };
    await assert.rejects(() => act("SAVE_PAIRED_DRAFT", baseFields([changedRow], changed)), /IC số lượng không khớp công thức/);
    data = await state();
    assert.deepEqual(data.quotations!.find(item => item.id === quote.id), quoteFrozen);
    assert.deepEqual(data.revisions.find(item => item.id === revision.id), submittedFrozen);

    const request = await prisma.workflowRequest.findUniqueOrThrow({ where: { id: revision.requestId } });
    const submitEvent = await prisma.workflowApprovalEvent.findFirstOrThrow({ where: { requestId: request.id, attemptId: request.currentAttemptId, action: "SUBMIT" } });
    await act("DECIDE", { requestId: revision.requestId, decision: "RETURN", reason: "Create parameter revision", correctionItems: "Update event parameters", module: "COSTFLOW", attemptId: request.currentAttemptId!, stepIndex: String(request.currentStep), submittedVersion: String(submitEvent.submittedVersion) }, manager);
    await act("COPY_IC", { sourceRevisionId: revision.id, pairedDraftId: draft.id, title: "Parameter revision", explanation: "Đã cập nhật tham số chương trình theo yêu cầu." });
    data = await state();
    const successor = data.revisions.find(item => item.parentRevisionId === revision.id)!;
    assert.ok(successor);
    assert.deepEqual(successor.parameterConfig, submitted.parameterConfig);
    successor.parameterConfig!.sharedValues.participants = "77";
    assert.equal(data.revisions.find(item => item.id === revision.id)!.parameterConfig!.sharedValues.participants, "12");
    assert.equal(data.revisions.find(item => item.id === revision.id)!.effective, false);
    assert.equal(data.expenses.length, 0);
    assert.equal(await prisma.costFlowCash.count({ where: { projectId: project.id } }), 0);
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).revenue, 731);
  } finally {
    await prisma.quotationTemplate.deleteMany({ where: { name: { startsWith: prefix } } });
    const projects = await prisma.project.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
    const projectIds = projects.map(item => item.id);
    await prisma.workflowNotificationDelivery.deleteMany({ where: { event: { request: { projectId: { in: projectIds } } } } });
    await prisma.workflowApprovalEvent.deleteMany({ where: { request: { projectId: { in: projectIds } } } });
    await prisma.workflowDecision.deleteMany({ where: { request: { projectId: { in: projectIds } } } });
    await prisma.workflowRequestReader.deleteMany({ where: { request: { projectId: { in: projectIds } } } });
    await prisma.workflowRequest.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.settlementExportSourceProjection.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.costFlowHistory.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.costFlowWorkspace.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.costFlowEvidence.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
