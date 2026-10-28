import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { withPhase15TestSchema } from "./phase15/fixture";
import { publishKnowledgeRevision } from "../lib/ai/knowledge/publications";
import { ingestKnowledgeBytes } from "../lib/ai/retrieval/ingestion";
import { postgresRetrievalStore } from "../lib/ai/retrieval/postgresRetrievalStore";
import { openAiCitation } from "../lib/ai/retrieval/citations";

test("publication fails closed, retrieval filters before text, and citation rechecks membership", async () => {
  await withPhase15TestSchema("migrate", async ({ client, schemaName, databaseUrl }) => {
    const priorUrl = process.env.DATABASE_URL;
    const priorRole = process.env.AI_KNOWLEDGE_PUBLISHER_ROLE;
    process.env.DATABASE_URL = databaseUrl;
    delete process.env.AI_KNOWLEDGE_PUBLISHER_ROLE;
    try {
      const ownerId = `owner-${schemaName}`;
      const memberId = `member-${schemaName}`;
      const otherId = `other-${schemaName}`;
      const projectId = `project-${schemaName}`;
      const otherProjectId = `other-project-${schemaName}`;
      await client.user.createMany({ data: [
        { id: ownerId, name: "Owner", email: `${schemaName}-owner@example.invalid`, passwordHash: "unused", role: "ADMIN" },
        { id: memberId, name: "Member", email: `${schemaName}-member@example.invalid`, passwordHash: "unused", role: "ACCOUNT" },
        { id: otherId, name: "Other", email: `${schemaName}-other@example.invalid`, passwordHash: "unused", role: "ACCOUNT" },
      ] });
      await client.project.createMany({ data: [
        { id: projectId, name: "Scoped", ownerId }, { id: otherProjectId, name: "Private", ownerId },
      ] });
      await client.projectMember.create({ data: { projectId, userId: memberId } });
      const createRevision = (project: string | null, kind: string, id: string, text: string) =>
        client.aiSourceRevision.create({ data: {
          projectId: project, scopeKey: project ? `PROJECT:${project}` : "GLOBAL",
          originKind: kind, originId: id, originVersion: "v1",
          sha256: createHash("sha256").update(text).digest("hex"),
          filename: "source.txt", mimeType: "text/plain", byteLength: Buffer.byteLength(text),
          authorityStatus: "CONFIRMED", snapshotBytes: Buffer.from(text), createdById: ownerId,
        } });
      const policyText = "policyterm approved";
      const sourceText = "invoiceterm visible amount";
      const foreignText = "invoiceterm private amount";
      const policy = await createRevision(null, "SOP", "sop1", policyText);
      await assert.rejects(() => publishKnowledgeRevision({ actorId: ownerId, sourceRevisionId: policy.id }));
      assert.equal(await client.aiKnowledgePublication.count(), 0);
      process.env.AI_KNOWLEDGE_PUBLISHER_ROLE = "ADMIN";
      const published = await publishKnowledgeRevision({ actorId: ownerId, sourceRevisionId: policy.id });
      await ingestKnowledgeBytes({ sourceRevisionId: policy.id, publicationId: published.id,
        parserVersion: "local-v1", bytes: Buffer.from(policyText) });
      const source = await createRevision(projectId, "VENDOR_INVOICE_FILE", "invoice1", sourceText);
      const foreign = await createRevision(otherProjectId, "VENDOR_INVOICE_FILE", "invoice2", foreignText);
      const first = await ingestKnowledgeBytes({ sourceRevisionId: source.id, parserVersion: "local-v1",
        bytes: Buffer.from(sourceText) });
      const repeated = await ingestKnowledgeBytes({ sourceRevisionId: source.id, parserVersion: "local-v1",
        bytes: Buffer.from(sourceText) });
      assert.deepEqual(repeated.chunks.map((chunk) => chunk.id), first.chunks.map((chunk) => chunk.id));
      const reparsed = await ingestKnowledgeBytes({ sourceRevisionId: source.id, parserVersion: "local-v2",
        bytes: Buffer.from(sourceText) });
      assert.notEqual(reparsed.publicationId, first.publicationId);
      assert.notEqual(reparsed.chunks[0].id, first.chunks[0].id);
      await assert.rejects(() => ingestKnowledgeBytes({ sourceRevisionId: source.id,
        parserVersion: "local-v2", bytes: Buffer.from("tampered source") }));
      await ingestKnowledgeBytes({ sourceRevisionId: foreign.id, parserVersion: "local-v1",
        bytes: Buffer.from(foreignText) });
      const hits = await postgresRetrievalStore.retrieve({ actorId: memberId, projectId }, "invoiceterm");
      assert.equal(hits.length, 2);
      assert.ok(hits.every((hit) => hit.sourceRevisionId === source.id && hit.textStart === 0));
      assert.deepEqual(hits.map((hit) => hit.historical).sort(), [false, true]);
      assert.equal((await postgresRetrievalStore.retrieve({ actorId: memberId, projectId }, "policyterm")).length, 1);
      await assert.rejects(() => postgresRetrievalStore.retrieve({ actorId: otherId, projectId }, "invoiceterm"));
      const goldText = Array.from({ length: 7 }, (_, index) => `goldterm fact ${index + 1}`).join("\n\n");
      const gold = await createRevision(projectId, "COSTFLOW_IC", "gold", goldText);
      await ingestKnowledgeBytes({ sourceRevisionId: gold.id, parserVersion: "local-v1", bytes: Buffer.from(goldText) });
      const goldHits = await postgresRetrievalStore.retrieve({ actorId: memberId, projectId }, "goldterm");
      const precisionAt6 = goldHits.filter((hit) => hit.sourceRevisionId === gold.id).length / 6;
      const recallAt6 = goldHits.filter((hit) => hit.sourceRevisionId === gold.id).length / 7;
      assert.equal(goldHits.length, 6);
      assert.equal(precisionAt6, 1);
      assert.equal(recallAt6, 6 / 7);
      assert.equal((await openAiCitation(memberId, hits[0].spanId)).sourceRevisionId, source.id);
      await assert.rejects(() => openAiCitation(otherId, hits[0].spanId));
      await client.projectMember.delete({ where: { projectId_userId: { projectId, userId: memberId } } });
      await assert.rejects(() => openAiCitation(memberId, hits[0].spanId));
      await client.aiKnowledgePublication.update({ where: { id: published.id }, data: { status: "SUPERSEDED" } });
      const policySpan = await client.aiSourceSpan.findFirstOrThrow({
        where: { sourceRevisionId: policy.id }, select: { id: true },
      });
      await assert.rejects(() => openAiCitation(ownerId, policySpan.id));
    } finally {
      const shared = (globalThis as unknown as { prisma?: { $disconnect(): Promise<void> } }).prisma;
      if (shared) { await shared.$disconnect(); delete (globalThis as unknown as { prisma?: unknown }).prisma; }
      if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
      if (priorRole === undefined) delete process.env.AI_KNOWLEDGE_PUBLISHER_ROLE;
      else process.env.AI_KNOWLEDGE_PUBLISHER_ROLE = priorRole;
    }
  });
});
