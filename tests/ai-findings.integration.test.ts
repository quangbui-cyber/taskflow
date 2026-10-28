import assert from "node:assert/strict";
import test from "node:test";
import { withPhase15TestSchema } from "./phase15/fixture";
import { resolveAiReadScope } from "../lib/ai/access/resolveAiReadScope";
import { snapshotSelectedAiSources } from "../lib/ai/sources/sourceRevisions";
import { evaluateAndPersistAiFindings, listAiFindings, resolveAiFinding } from "../lib/ai/risk/findingService";

test("findings persist by run, hide from foreign projects and resolve with an append-only event", async () => {
  await withPhase15TestSchema("migrate", async ({ client, schemaName, databaseUrl }) => {
    const priorUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    try {
      const actorId = `actor-${schemaName}`;
      const outsiderId = `outsider-${schemaName}`;
      const projectId = `project-${schemaName}`;
      const fileId = `file-${schemaName}`;
      await client.user.createMany({ data: [
        { id: actorId, email: `${schemaName}@example.invalid`, name: "Uploader", passwordHash: "unused", role: "ACCOUNT" },
        { id: outsiderId, email: `other-${schemaName}@example.invalid`, name: "Other", passwordHash: "unused", role: "ACCOUNT" },
      ] });
      await client.project.create({ data: { id: projectId, name: "Finding project", ownerId: actorId } });
      await client.projectFile.create({ data: { id: fileId, projectId, name: "source.txt", mimeType: "text/plain",
        size: 8, data: Buffer.from("PO 10001") } });
      const scope = await resolveAiReadScope(actorId, { projectId,
        sourceIds: [`PROJECT_FILE:${fileId}`], purpose: "DOCUMENT_EXTRACTION" });
      const [revision] = await snapshotSelectedAiSources(actorId, scope.sources);
      const run = await client.aiRun.create({ data: {
        projectId, actorId, scopeKey: scope.scopeKey, runType: "DOCUMENT_EXTRACTION", status: "SUCCEEDED",
        sourceBundleHash: revision.sha256, parserVersion: "test", pipelineVersion: "test",
        promptVersion: "test", configVersion: "test", provider: "none", model: "none",
        scopeVersion: "1", scopeHash: scope.scopeHash, idempotencyKey: `finding-${schemaName}`,
        sources: { create: [{ sourceRevisionId: revision.id, role: "PRIMARY" }] },
      } });
      await client.aiCandidateField.create({ data: { runId: run.id, scopeKey: scope.scopeKey,
        rowKey: "document", fieldKey: "poNumber", aiValue: null, provenance: "PARSER", confidence: "0" } });
      await client.aiCandidateField.create({ data: { runId: run.id, scopeKey: scope.scopeKey,
        rowKey: "document", fieldKey: "description", aiValue: "Possible mismatch", provenance: "MODEL", confidence: "0.3" } });
      assert.deepEqual(await evaluateAndPersistAiFindings(actorId, projectId, run.id), { created: 2, total: 2 });
      assert.deepEqual(await evaluateAndPersistAiFindings(actorId, projectId, run.id), { created: 0, total: 2 });
      const findings = await listAiFindings(actorId, projectId);
      assert.deepEqual(new Set(findings.map((item) => item.kind)), new Set(["MISSING_DATA", "AI_SUSPICION"]));
      const finding = findings.find((item) => item.kind === "MISSING_DATA")!;
      assert.equal(finding.kind, "MISSING_DATA");
      await assert.rejects(() => listAiFindings(outsiderId, projectId));
      await assert.rejects(() => resolveAiFinding(outsiderId, projectId, finding.id, "FIXED", "Checked source"));
      await assert.rejects(() => resolveAiFinding(actorId, projectId, finding.id, "FIXED", ""));
      await resolveAiFinding(actorId, projectId, finding.id, "EXCEPTION_ACCEPTED", "Checked source manually");
      const closed = await client.aiFinding.findUniqueOrThrow({ where: { id: finding.id } });
      assert.equal(closed.status, "EXCEPTION_ACCEPTED");
      assert.equal(closed.resolvedById, actorId);
      assert.ok(closed.resolvedAt);
      assert.equal(await client.aiReviewEvent.count({ where: { findingId: finding.id, action: "EXCEPTION_ACCEPTED" } }), 1);
      assert.equal(await client.workflowRequest.count({ where: { projectId } }), 0);
    } finally { process.env.DATABASE_URL = priorUrl; }
  });
});
