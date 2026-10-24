import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  PHASE12_TEST_DATABASE_URL,
  createPhase12Scenario,
  withPhase12TestSchema,
} from "./phase12/pilotFixture.ts";

const forbiddenAcceptanceClaims = [
  "pilot_accepted",
  "company_accepted",
  "production_accepted",
];

function form(command, fields = {}) {
  const value = new FormData();
  value.set("command", command);
  for (const [key, raw] of Object.entries(fields)) {
    for (const item of Array.isArray(raw) ? raw : [raw]) value.append(key, String(item));
  }
  return value;
}

function settlementForm(command, projectId, settlementVersion, requestId) {
  return form(command, {
    projectId,
    settlementVersion,
    ...(requestId ? { requestId } : {}),
  });
}

test("Phase 12 representative lifecycles use production boundaries and remain automated-local evidence", async () => {
  process.env.DATABASE_URL = PHASE12_TEST_DATABASE_URL;
  await withPhase12TestSchema(async ({ client, schemaName }) => {
    if (globalThis.prisma) {
      await globalThis.prisma.$disconnect();
      delete globalThis.prisma;
    }
    const { prisma: servicePrisma } = await import(`../lib/prisma.ts?phase12=${schemaName}`);
    const activeSchema = await servicePrisma.$queryRawUnsafe("SELECT current_schema()::text AS name");
    assert.equal(activeSchema[0].name, schemaName, "production services use the disposable Phase 12 schema");
    const { executeFinance } = await import(`../lib/costflow/service.ts?phase12=${schemaName}`);
    const { executeActualCostCommand } = await import(`../lib/costflow/actualCostService.ts?phase12=${schemaName}`);
    const { executeSettlementCommand } = await import(`../lib/costflow/settlementService.ts?phase12=${schemaName}`);

    const execute = async (projectId, actor, command, fields = {}) => {
      const workspace = await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId } });
      return executeFinance(projectId, workspace.version, actor, form(command, fields), null);
    };
    const approveIc = async (projectId, actor, requestId) => {
      const request = await client.workflowRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { approvalEvents: { orderBy: { createdAt: "asc" } } },
      });
      const submitted = request.approvalEvents.find(
        event => event.action === "SUBMIT" && event.attemptId === request.currentAttemptId,
      );
      assert.ok(submitted, "submitted version is persisted before a decision");
      return execute(projectId, actor, "DECIDE", {
        requestId,
        module: request.module,
        attemptId: request.currentAttemptId,
        stepIndex: request.currentStep,
        submittedVersion: submitted.submittedVersion,
        decision: "APPROVE",
        reason: "Phase 12 automated boundary verification",
        ...(request.currentStep === 1 ? { reviewConfirmed: "yes" } : {}),
      });
    };

    const ledgers = [];
    for (const kind of ["TEAMBUILDING", "POSM_JABIL"]) {
      const scenario = await createPhase12Scenario(client, kind);
      const fixtureSchema = await client.$queryRawUnsafe("SELECT current_schema()::text AS name");
      assert.equal(fixtureSchema[0].name, schemaName);
      assert.ok(await servicePrisma.project.findUnique({ where: { id: scenario.projectId } }));
      const [ownerId, managerId, accountantId, ceoId] = scenario.actorIds;
      const owner = { id: ownerId, role: "ACCOUNT" };
      const manager = { id: managerId, role: "USER" };
      const accountant = { id: accountantId, role: "ACCOUNT" };
      const ceo = { id: ceoId, role: "USER" };

      await client.workflowRoleGrant.updateMany({
        where: { role: "AC_DD", revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await client.workflowRoleGrant.create({
        data: { userId: managerId, role: "AC_DD", grantedById: ceoId },
      });

      const quoteLine = kind === "TEAMBUILDING"
        ? { description: "Teambuilding 120 khách", unit: "gói", quantity: "120", days: "2", unitPrice: "100000", basis: "NET", vatPercent: "8" }
        : { description: "POSM JABIL", unit: "gói", quantity: "2", days: "1", unitPrice: "5000000", basis: "NET", vatPercent: "8" };
      const quoteResult = await execute(scenario.projectId, owner, "SAVE_QUOTATION", {
        title: `${kind} quotation`,
        customer: "Phase 12 synthetic customer",
        lines: JSON.stringify([quoteLine]),
      });
      const workspaceAfterQuote = await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: scenario.projectId } });
      const quoteData = workspaceAfterQuote.data;
      const quotation = quoteData.quotations.find(item => item.id === quoteResult.quotationId);
      assert.ok(quotation);

      const icEvidenceBytes = Buffer.from(`phase12:${kind}:ic-estimate`);
      const icEvidence = await client.costFlowEvidence.create({
        data: {
          projectId: scenario.projectId,
          sourceFileId: "",
          kind: "IC_ESTIMATE",
          name: `${kind}-ic-estimate.txt`,
          mimeType: "text/plain",
          data: icEvidenceBytes,
          sha256: createHash("sha256").update(icEvidenceBytes).digest("hex"),
          createdBy: ownerId,
        },
      });

      const icResult = await execute(scenario.projectId, owner, "SAVE_IC", {
        title: `${kind} IC`,
        lines: JSON.stringify([{
          ...quoteLine,
          unitPrice: kind === "TEAMBUILDING" ? "75000" : "3500000",
          quotationId: quotation.id,
          quotationLineId: quotation.lines[0].id,
          evidenceIds: [icEvidence.id],
        }]),
      });
      assert.ok(icResult.revisionId);
      const icRequest = await client.workflowRequest.findFirstOrThrow({
        where: { projectId: scenario.projectId, kind: "IC", state: "DRAFT" },
      });
      await execute(scenario.projectId, owner, "SUBMIT", {
        requestId: icRequest.id,
        explanation: "Phase 12 automated lifecycle",
      });
      await approveIc(scenario.projectId, manager, icRequest.id);
      const afterManager = await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: scenario.projectId } });
      assert.equal(afterManager.data.revisions.find(item => item.id === icResult.revisionId).effective, true);
      assert.equal(await client.costFlowCash.count({ where: { projectId: scenario.projectId } }), 0);
      await approveIc(scenario.projectId, accountant, icRequest.id);
      await approveIc(scenario.projectId, ceo, icRequest.id);
      const approvedIc = await client.workflowRequest.findUniqueOrThrow({ where: { id: icRequest.id } });
      assert.equal(approvedIc.state, "APPROVED");

      const finance = (await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: scenario.projectId } })).data;
      const revision = finance.revisions.find(item => item.id === icResult.revisionId);
      const icLine = revision.lines[0];
      const invoice = new TextEncoder().encode(`phase12:${kind}:invoice`);
      const invoiceEvidence = await client.costFlowEvidence.create({ data: {
        projectId: scenario.projectId,
        sourceFileId: "",
        kind: "VAT_INVOICE",
        name: `${kind}.txt`,
        mimeType: "text/plain",
        data: invoice,
        sha256: createHash("sha256").update(invoice).digest("hex"),
        createdBy: ownerId,
      } });
      const actual = await executeActualCostCommand(owner, {
        command: "SAVE_LINE",
        projectId: scenario.projectId,
        sourceKind: "IC_LINKED",
        revisionId: revision.id,
        icLineId: icLine.id,
        recipientKey: `USER:${ownerId}`,
        description: `${kind} actual cost`,
        fundingSource: "EMPLOYEE_OUT_OF_POCKET",
        quantity: icLine.quantity,
        days: icLine.days,
        unitPrice: icLine.unitPrice,
        unit: icLine.unit,
        basis: icLine.basis,
        vatPercent: icLine.vatPercent,
        evidenceIds: [invoiceEvidence.id],
      }, { notify: async () => undefined });
      const draft = await client.actualCostSheetRevision.findFirstOrThrow({
        where: { projectId: scenario.projectId, state: "DRAFT" },
      });
      await executeActualCostCommand(owner, {
        command: "UPDATE_LINE_STATUS",
        projectId: scenario.projectId,
        lineId: actual.lineId,
        internalStatus: "ACCOUNT_REVIEWED",
        revisionId: draft.id,
        expectedMutationVersion: draft.mutationVersion,
      }, { notify: async () => undefined });
      const checkedDraft = await client.actualCostSheetRevision.findUniqueOrThrow({ where: { id: draft.id } });
      await executeActualCostCommand(owner, {
        command: "SUBMIT_SHEET",
        projectId: scenario.projectId,
        revisionId: draft.id,
        expectedMutationVersion: checkedDraft.mutationVersion,
        missingEvidenceExplanation: "Chưa có đầy đủ chứng từ; DD xem xét.",
      }, { notify: async () => undefined });
      const submitted = await client.actualCostSheetRevision.findUniqueOrThrow({ where: { id: draft.id } });
      await executeActualCostCommand(manager, {
        command: "DECIDE_SHEET",
        projectId: scenario.projectId,
        revisionId: draft.id,
        expectedMutationVersion: submitted.mutationVersion,
        manifestHash: submitted.manifestHash,
        action: "APPROVED",
        reason: "Evidence and IC lineage verified",
        acknowledgeMissingEvidence: true,
      }, { notify: async () => undefined });
      const actualVersion = await client.actualCostVersion.findFirstOrThrow({ where: { lineId: actual.lineId, state: "APPROVED" } });
      const actualApproval = await client.actualCostApproval.findFirstOrThrow({ where: { versionId: actualVersion.id, action: "APPROVED" } });

      const createdSettlement = await executeSettlementCommand(
        owner,
        settlementForm("CREATE_SETTLEMENT_DOSSIER", scenario.projectId, 0),
        null,
      );
      const submittedSettlement = settlementForm(
        "SUBMIT_SETTLEMENT_DOSSIER",
        scenario.projectId,
        0,
        createdSettlement.requestId,
      );
      await executeSettlementCommand(owner, submittedSettlement, null);
      for (const [index, actor] of [manager, accountant, ceo].entries()) {
        const decision = settlementForm(
          "DECIDE_SETTLEMENT_DOSSIER",
          scenario.projectId,
          index + 1,
          createdSettlement.requestId,
        );
        decision.set("decision", "APPROVE");
        decision.set("reason", "Phase 12 automated settlement verification");
        await executeSettlementCommand(actor, decision, null);
      }

      const settlementRequest = await client.workflowRequest.findUniqueOrThrow({ where: { id: createdSettlement.requestId } });
      const settlementPayload = settlementRequest.payload.settlement;
      const settlementVersion = await client.projectSettlementVersion.findUniqueOrThrow({
        where: { id: settlementPayload.dossierVersionId },
      });
      const sourceProjection = await client.settlementExportSourceProjection.findFirstOrThrow({
        where: { sourceKind: "PROJECT_SETTLEMENT", sourceId: settlementVersion.id },
      });
      const locks = await client.settlementLock.findMany({ where: { dossierVersionId: settlementVersion.id } });
      assert.equal(settlementRequest.state, "APPROVED");
      assert.equal(locks.length, 1);
      assert.equal(settlementVersion.approvedAttemptId, settlementRequest.currentAttemptId);
      assert.equal(settlementVersion.approvedProjectionHash, settlementVersion.canonicalHash);
      assert.equal(sourceProjection.approvalAttemptId, settlementVersion.approvedAttemptId);
      assert.equal(await client.workflowApprovedSnapshot.count({ where: { requestId: icRequest.id } }), 0);
      assert.equal(await client.workflowSigningEvent.count({ where: { requestId: icRequest.id } }), 0);
      assert.equal(finance.closed, false);

      ledgers.push({
        provenance: "automated_local",
        releaseStatus: "NOT_READY",
        scenario: kind,
        projectId: scenario.projectId,
        quotationId: quotation.id,
        icRevisionId: revision.id,
        icRequestId: icRequest.id,
        actualCostVersionId: actualVersion.id,
        actualCostApprovalId: actualApproval.id,
        actualCostApprovalAttemptId: actualApproval.attemptId,
        settlementRequestId: settlementRequest.id,
        settlementVersionId: settlementVersion.id,
        settlementAttemptId: settlementVersion.approvedAttemptId,
        canonicalHash: settlementVersion.canonicalHash,
        sourceManifestHash: settlementVersion.sourceManifestHash,
        exportSourceSealId: sourceProjection.id,
        settlementLockIds: locks.map(lock => lock.id),
        cashAllocationIds: [],
        independentAxes: {
          icApproval: approvedIc.state,
          icEffective: revision.effective,
          actualCost: "APPROVED",
          actualCash: "NOT_EXECUTED",
          signing: "NOT_APPLICABLE_TO_IC_AND_UNSIGNED_SETTLEMENT",
          settlementLock: "LOCKED",
          taskCompletion: "NOT_EXECUTED",
          financialClose: "OPEN",
        },
        humanOnlyGates: [
          "SIGNED_PAYMENT_APPROVAL_REQUIRED_BEFORE_CASH",
          "AUTHENTICATED_HUMAN_PILOT_NOT_RUN",
          "COMPANY_AND_PRODUCTION_ACCEPTANCE_NOT_GRANTED",
        ],
      });
    }

    assert.equal(ledgers.length, 2);
    const serialized = JSON.stringify(ledgers);
    for (const forbidden of forbiddenAcceptanceClaims) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
    assert.ok(ledgers.every(ledger => ledger.provenance === "automated_local"));
    assert.ok(ledgers.every(ledger => ledger.cashAllocationIds.length === 0));
    assert.ok(ledgers.every(ledger => ledger.settlementLockIds.length === 1));
  });
});
