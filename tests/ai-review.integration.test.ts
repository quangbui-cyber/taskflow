import assert from "node:assert/strict";
import test from "node:test";

import { withPhase15TestSchema } from "./phase15/fixture";
import { resolveAiReadScope } from "../lib/ai/access/resolveAiReadScope";
import { snapshotSelectedAiSources } from "../lib/ai/sources/sourceRevisions";
import { extractAndPersistDocumentRun } from "../lib/ai/extraction/documentExtraction";
import { completeAiReview, recordAiFieldReview } from "../lib/ai/review/reviewService";

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
    } finally {
      const shared = (globalThis as unknown as { prisma?: { $disconnect(): Promise<void> } }).prisma;
      if (shared) { await shared.$disconnect(); delete (globalThis as unknown as { prisma?: unknown }).prisma; }
      if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
    }
  });
});
