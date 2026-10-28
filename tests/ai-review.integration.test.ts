import assert from "node:assert/strict";
import test from "node:test";

import { withPhase15TestSchema } from "./phase15/fixture";
import { resolveAiReadScope } from "../lib/ai/access/resolveAiReadScope";
import { snapshotSelectedAiSources } from "../lib/ai/sources/sourceRevisions";
import { extractAndPersistDocumentRun } from "../lib/ai/extraction/documentExtraction";
import { blankPairedRow } from "../lib/costflow/pairedDraft";
import { emptyFinance } from "../lib/costflow/types";
import { applyAiReviewToDraft, completeAiReview, createDocumentIntakeDraft,
  getAiReviewSnapshot, getDocumentIntakeDraft, listDocumentIntakeDrafts,
  prepareAiApplyConflicts, recordAiFieldReview } from "../lib/ai/review/reviewService";

test("extraction stores grounded candidates only after explicit run execution", async () => {
  await withPhase15TestSchema("migrate", async ({ client, schemaName, databaseUrl }) => {
    const priorUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    try {
      const actorId = `actor-${schemaName}`;
      const projectId = `project-${schemaName}`;
      const fileId = `file-${schemaName}`;
      await client.user.create({ data: { id: actorId, email: `${schemaName}@example.invalid`,
        name: "Uploader", passwordHash: "unused", role: "ACCOUNT" } });
      await client.project.create({ data: { id: projectId, name: "Review project", ownerId: actorId } });
      await client.projectFile.create({ data: { id: fileId, projectId, name: "po.txt", mimeType: "text/plain",
        size: 65, data: Buffer.from("Jabil PURCHASE ORDER\nC-10003769550 14/09/2026\n1000 VND") } });
      const scope = await resolveAiReadScope(actorId, { projectId,
        sourceIds: [`PROJECT_FILE:${fileId}`], purpose: "DOCUMENT_EXTRACTION" });
      const [revision] = await snapshotSelectedAiSources(actorId, scope.sources);
      const run = await client.aiRun.create({ data: {
        project: { connect: { id: projectId } }, actor: { connect: { id: actorId } },
        scopeKey: scope.scopeKey, runType: "DOCUMENT_EXTRACTION", status: "READY",
        sourceBundleHash: revision.sha256, parserVersion: "local-v1", pipelineVersion: "v1",
        promptVersion: "v1", configVersion: "v1", provider: "none", model: "none",
        scopeVersion: "1", scopeHash: scope.scopeHash, idempotencyKey: `review-${schemaName}`,
        sources: { create: [{ sourceRevision: { connect: { id_scopeKey: { id: revision.id, scopeKey: scope.scopeKey } } }, role: "PRIMARY" }] },
      } });
      assert.equal(await client.aiCandidateField.count({ where: { runId: run.id } }), 0);
      const outcome = await extractAndPersistDocumentRun(actorId, projectId, run.id);
      assert.equal(outcome.status, "INCOMPLETE");
      const candidates = await client.aiCandidateField.findMany({ where: { runId: run.id }, include: { sourceSpan: true } });
      assert.ok(candidates.length > 0);
      assert.ok(candidates.every((candidate) => candidate.sourceSpan?.sourceRevisionId === revision.id &&
        candidate.sourceSpan?.textStart !== null));
      assert.equal((await client.aiRun.findUniqueOrThrow({ where: { id: run.id } })).outcomeCode, "INCOMPLETE");
      assert.equal((await extractAndPersistDocumentRun(actorId, projectId, run.id)).reused, true);
      assert.equal(await client.aiCandidateField.count({ where: { runId: run.id } }), candidates.length);
      await assert.rejects(() => completeAiReview(actorId, projectId, run.id));
      for (const candidate of candidates) {
        await recordAiFieldReview(actorId, projectId, run.id, candidate.fieldKey === "poNumber" ? {
          candidateFieldId: candidate.id, choice: "CORRECT", value: "C-10003769551",
          reason: "Checked source document",
        } : { candidateFieldId: candidate.id, choice: "ACCEPT_AI" });
      }
      assert.equal((await completeAiReview(actorId, projectId, run.id)).reused, false);
      assert.equal((await completeAiReview(actorId, projectId, run.id)).reused, true);
      assert.equal((await client.aiRun.findUniqueOrThrow({ where: { id: run.id } })).reviewStatus, "COMPLETED");
      assert.equal(await client.aiReviewEvent.count({ where: { runId: run.id } }), candidates.length + 1);
      await assert.rejects(() => recordAiFieldReview(actorId, projectId, run.id, {
        candidateFieldId: candidates[0].id, choice: "ACCEPT_AI",
      }));
      const draft = await createDocumentIntakeDraft(actorId, projectId, "PO");
      assert.equal((await getDocumentIntakeDraft(actorId, projectId, draft.id)).version, 1);
      assert.equal((await listDocumentIntakeDrafts(actorId, projectId))[0].id, draft.id);
      await assert.rejects(() => getDocumentIntakeDraft("unrelated-user", projectId, draft.id));
      const before = await client.documentIntakeDraft.findUniqueOrThrow({ where: { id: draft.id } });
      assert.deepEqual(before.fields, {});
      const prepared = await prepareAiApplyConflicts(actorId, projectId, run.id, "PO", draft.id);
      assert.equal(prepared.targetVersion, "1");
      assert.ok(prepared.fields.every((field) => field.defaultDecision === "KEEP_CURRENT"));
      assert.deepEqual((await client.documentIntakeDraft.findUniqueOrThrow({ where: { id: draft.id } })).fields, {});
      const number = candidates.find((candidate) => candidate.fieldKey === "poNumber")!;
      const command = { expectedVersion: "1", idempotencyKey: `apply-${schemaName}`,
        decisions: [{ candidateFieldId: number.id, decision: "APPLY_REVIEWED" as const }] };
      const receipt = await applyAiReviewToDraft(actorId, projectId, run.id, "PO", draft.id, command);
      assert.equal(receipt.targetVersionAfter, "2");
      const recorded = receipt.fieldDecisions as { fields: Array<{ fieldKey: string; correctedValue: string | null;
        sourceSpanId: string | null; reason: string | null }> };
      assert.equal(recorded.fields.find((field) => field.fieldKey === "poNumber")?.correctedValue, "C-10003769551");
      assert.ok(recorded.fields.find((field) => field.fieldKey === "poNumber")?.sourceSpanId);
      assert.equal(recorded.fields.find((field) => field.fieldKey === "poNumber")?.reason, "Checked source document");
      assert.equal((await client.documentIntakeDraft.findUniqueOrThrow({ where: { id: draft.id } })).version, 2);
      assert.deepEqual((await client.documentIntakeDraft.findUniqueOrThrow({ where: { id: draft.id } })).fields,
        { poNumber: "C-10003769551" });
      assert.equal((await applyAiReviewToDraft(actorId, projectId, run.id, "PO", draft.id, command)).id, receipt.id);
      assert.equal(await client.aiApplicationReceipt.count({ where: { runId: run.id } }), 1);
      const projection = await getAiReviewSnapshot(actorId, projectId, run.id);
      assert.equal(projection.reviewStatus, "COMPLETED");
      assert.ok(projection.fields.every((field) => field.sourceSpan?.sourceRevisionId === revision.id));
      assert.equal(projection.receipts[0].id, receipt.id);
      await assert.rejects(() => getAiReviewSnapshot("unrelated-user", projectId, run.id));
      await assert.rejects(() => applyAiReviewToDraft(actorId, projectId, run.id, "PO", draft.id,
        { ...command, idempotencyKey: `stale-${schemaName}` }));
      const rollbackDraft = await createDocumentIntakeDraft(actorId, projectId, "PO");
      await client.$executeRawUnsafe(`CREATE FUNCTION "${schemaName}".reject_ai_receipt() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'receipt rejected'; END $$ LANGUAGE plpgsql`);
      await client.$executeRawUnsafe(`CREATE TRIGGER reject_ai_receipt BEFORE INSERT ON "${schemaName}"."AiApplicationReceipt" FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_ai_receipt()`);
      await assert.rejects(() => applyAiReviewToDraft(actorId, projectId, run.id, "PO", rollbackDraft.id,
        { ...command, idempotencyKey: `rollback-${schemaName}` }));
      const rolledBack = await client.documentIntakeDraft.findUniqueOrThrow({ where: { id: rollbackDraft.id } });
      assert.equal(rolledBack.version, 1);
      assert.deepEqual(rolledBack.fields, {});
      await client.$executeRawUnsafe(`DROP TRIGGER reject_ai_receipt ON "${schemaName}"."AiApplicationReceipt"`);
      await client.documentIntakeDraft.update({ where: { id: draft.id }, data: { status: "LOCKED" } });
      await assert.rejects(() => applyAiReviewToDraft(actorId, projectId, run.id, "PO", draft.id,
        { ...command, expectedVersion: "2", idempotencyKey: `locked-${schemaName}` }));
    } finally {
      const shared = (globalThis as unknown as { prisma?: { $disconnect(): Promise<void> } }).prisma;
      if (shared) { await shared.$disconnect(); delete (globalThis as unknown as { prisma?: unknown }).prisma; }
      if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
    }
  });
});

test("IC apply changes only the owned PairedDraft row and leaves revision authority intact", async () => {
  await withPhase15TestSchema("migrate", async ({ client, schemaName, databaseUrl }) => {
    const priorUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    try {
      const actorId = `ic-actor-${schemaName}`;
      const projectId = `ic-project-${schemaName}`;
      const requestId = `ic-request-${schemaName}`;
      const revisionId = `ic-revision-${schemaName}`;
      const draftId = `ic-draft-${schemaName}`;
      await client.user.create({ data: { id: actorId, email: `${schemaName}-ic@example.invalid`,
        name: "IC owner", passwordHash: "unused", role: "ACCOUNT" } });
      await client.project.create({ data: { id: projectId, name: "IC project", ownerId: actorId } });
      await client.workflowRequest.create({ data: { id: requestId, projectId, module: "COSTFLOW",
        kind: "IC", title: "IC draft", creatorId: actorId, cashAssigneeId: actorId,
        steps: [], payload: {}, state: "DRAFT" } });
      const data = emptyFinance();
      data.revisions.push({ id: revisionId, number: 1, requestId, effective: false,
        createdBy: actorId, lines: [{ id: "line1", itemId: "item1", description: "Line",
          quantity: "2", days: "1", unitPrice: "100", vatPercent: "0.08",
          basis: "NET", unit: "pcs", notes: "", evidenceIds: [] } as never],
        poIds: [], pairedDraftId: draftId });
      const row = blankPairedRow("item1");
      row.buy.unitPrice = "50";
      data.quotationDrafts = [{ id: draftId, version: 1, createdBy: actorId,
        workspaceMode: "ic", title: "IC", clientId: "", customer: "", notes: "",
        rows: [row], globalEvidenceIds: [], icRevisionId: revisionId }];
      await client.costFlowWorkspace.create({ data: { projectId, version: 1, data: data as never } });
      const scope = await resolveAiReadScope(actorId, { projectId,
        sourceIds: [`COSTFLOW_IC:${revisionId}`], purpose: "DOCUMENT_EXTRACTION" });
      const [source] = await snapshotSelectedAiSources(actorId, scope.sources);
      const run = await client.aiRun.create({ data: {
        project: { connect: { id: projectId } }, actor: { connect: { id: actorId } },
        scopeKey: scope.scopeKey, runType: "DOCUMENT_EXTRACTION", status: "READY",
        sourceBundleHash: source.sha256, parserVersion: "local-v1", pipelineVersion: "v1",
        promptVersion: "v1", configVersion: "v1", provider: "none", model: "none",
        scopeVersion: "1", scopeHash: scope.scopeHash, idempotencyKey: `ic-${schemaName}`,
        sources: { create: [{ sourceRevision: { connect: { id_scopeKey: {
          id: source.id, scopeKey: scope.scopeKey,
        } } }, role: "PRIMARY" }] },
      } });
      assert.equal((await extractAndPersistDocumentRun(actorId, projectId, run.id)).status, "READY");
      const candidates = await client.aiCandidateField.findMany({ where: { runId: run.id } });
      assert.ok(candidates.some((field) => field.fieldKey === "buy.unitPrice" && field.rowKey === "item1"));
      for (const candidate of candidates) await recordAiFieldReview(actorId, projectId, run.id, {
        candidateFieldId: candidate.id, choice: "ACCEPT_AI",
      });
      await completeAiReview(actorId, projectId, run.id);
      const prepared = await prepareAiApplyConflicts(actorId, projectId, run.id, "IC", draftId);
      assert.equal(prepared.targetVersion, "1");
      const price = candidates.find((field) => field.fieldKey === "buy.unitPrice")!;
      assert.equal(prepared.fields.find((field) => field.candidateFieldId === price.id)?.currentValue, "50");
      await applyAiReviewToDraft(actorId, projectId, run.id, "IC", draftId, {
        expectedVersion: "1", idempotencyKey: `icapply-${schemaName}`,
        decisions: [{ candidateFieldId: price.id, decision: "APPLY_REVIEWED" }],
      });
      const updated = (await client.costFlowWorkspace.findUniqueOrThrow({ where: { projectId } })).data as unknown as typeof data;
      assert.equal(updated.quotationDrafts?.[0].rows[0].buy.unitPrice, "100");
      assert.equal(updated.quotationDrafts?.[0].version, 2);
      assert.equal(updated.revisions[0].lines[0].unitPrice, "100");
      await client.workflowRequest.update({ where: { id: requestId }, data: { state: "APPROVED" } });
      await assert.rejects(() => prepareAiApplyConflicts(actorId, projectId, run.id, "IC", draftId));
    } finally {
      const shared = (globalThis as unknown as { prisma?: { $disconnect(): Promise<void> } }).prisma;
      if (shared) { await shared.$disconnect(); delete (globalThis as unknown as { prisma?: unknown }).prisma; }
      if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
    }
  });
});
