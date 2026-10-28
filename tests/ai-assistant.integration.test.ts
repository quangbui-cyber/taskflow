import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { withPhase15TestSchema } from "./phase15/fixture";
import { ingestKnowledgeBytes } from "../lib/ai/retrieval/ingestion";
import { openAiCitation } from "../lib/ai/retrieval/citations";
import { answerAuthorizedQuestion, validateCitedAnswer } from "../lib/ai/qa/answer";

test("assistant keeps project evidence scoped, cites exact spans, and revokes access", async () => {
  await withPhase15TestSchema("migrate", async ({ client, schemaName, databaseUrl }) => {
    const priorUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    try {
      const ownerId = `owner-${schemaName}`;
      const memberId = `member-${schemaName}`;
      const outsiderId = `outsider-${schemaName}`;
      const projectId = `project-${schemaName}`;
      const foreignProjectId = `foreign-${schemaName}`;
      await client.user.createMany({ data: [
        { id: ownerId, name: "Owner", email: `${schemaName}-owner@example.invalid`, passwordHash: "unused", role: "ADMIN" },
        { id: memberId, name: "Member", email: `${schemaName}-member@example.invalid`, passwordHash: "unused", role: "ACCOUNT" },
        { id: outsiderId, name: "Outsider", email: `${schemaName}-outsider@example.invalid`, passwordHash: "unused", role: "ACCOUNT" },
      ] });
      await client.project.createMany({ data: [
        { id: projectId, name: "Visible", ownerId },
        { id: foreignProjectId, name: "Private", ownerId },
      ] });
      await client.projectMember.create({ data: { projectId, userId: memberId } });
      const add = async (project: string, id: string, text: string, version = "v1") => {
        const revision = await client.aiSourceRevision.create({ data: {
          projectId: project, scopeKey: `PROJECT:${project}`, originKind: "COSTFLOW_IC",
          originId: id, originVersion: version, filename: `${id}.txt`, mimeType: "text/plain",
          sha256: createHash("sha256").update(text).digest("hex"), byteLength: Buffer.byteLength(text),
          snapshotBytes: Buffer.from(text), authorityStatus: "CONFIRMED", createdById: ownerId,
        } });
        await ingestKnowledgeBytes({ sourceRevisionId: revision.id, parserVersion: "local-v1", bytes: Buffer.from(text) });
        return revision;
      };
      await add(projectId, "visible", "orchidbudget approved amount is 120000 VND");
      await add(foreignProjectId, "private", "orchidbudget secret amount is 900000 VND");
      const answer = await answerAuthorizedQuestion({ actorId: memberId,
        context: { kind: "project", projectId }, question: "orchidbudget" });
      assert.equal(answer.status, "OK");
      assert.equal(answer.claims.length, 1);
      assert.ok(answer.claims[0].text.includes("120000"));
      assert.ok(!JSON.stringify(answer).includes("900000"));
      assert.equal((await openAiCitation(memberId, answer.claims[0].citationSpanIds[0])).originVersion, "v1");
      assert.equal(validateCitedAnswer({ ...answer, claims: [{ ...answer.claims[0], citationSpanIds: [] }] }, []).status, "INCOMPLETE");
      await assert.rejects(() => answerAuthorizedQuestion({ actorId: outsiderId,
        context: { kind: "project", projectId }, question: "orchidbudget" }));
      const global = await answerAuthorizedQuestion({ actorId: memberId,
        context: { kind: "global" }, question: "orchidbudget" });
      assert.equal(global.status, "OK");
      assert.ok(!JSON.stringify(global).includes("900000"));
      const insufficient = await answerAuthorizedQuestion({ actorId: memberId,
        context: { kind: "project", projectId }, question: "unfindabletoken" });
      assert.equal(insufficient.status, "INSUFFICIENT");
      assert.equal(insufficient.claims.length, 0);
      await add(projectId, "visible", "orchidbudget approved amount is 130000 VND", "v2");
      const conflict = await answerAuthorizedQuestion({ actorId: memberId,
        context: { kind: "project", projectId }, question: "orchidbudget" });
      assert.equal(conflict.status, "CONFLICT");
      assert.equal(conflict.claims.length, 0);
      await client.projectMember.delete({ where: { projectId_userId: { projectId, userId: memberId } } });
      await assert.rejects(() => openAiCitation(memberId, answer.claims[0].citationSpanIds[0]));
    } finally {
      const shared = (globalThis as unknown as { prisma?: { $disconnect(): Promise<void> } }).prisma;
      if (shared) { await shared.$disconnect(); delete (globalThis as unknown as { prisma?: unknown }).prisma; }
      if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
    }
  });
});
