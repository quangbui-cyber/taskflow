import assert from "node:assert/strict";
import test from "node:test";

import { withPhase15TestSchema } from "./phase15/fixture";
import { AiSourceNotFoundError, resolveAiReadScope, type AiScopeReader } from "../lib/ai/access/resolveAiReadScope";
import { snapshotSelectedAiSources, type AiSourceStore } from "../lib/ai/sources/sourceRevisions";
import { createAiRun, readAiRun } from "../lib/ai/runs/aiRunService";

test("selected source is scoped before bytes, and its immutable snapshot survives a mutable file edit", async () => {
  await withPhase15TestSchema("migrate", async ({ client, schemaName }) => {
    const actorId = `actor-${schemaName}`;
    const projectId = `project-${schemaName}`;
    const foreignId = `foreign-${schemaName}`;
    const fileId = `file-${schemaName}`;
    await client.user.create({ data: { id: actorId, email: `${schemaName}@example.invalid`, name: "AI actor", passwordHash: "unused", role: "ACCOUNT" } });
    await client.project.create({ data: { id: projectId, name: "Scoped project", ownerId: actorId } });
    await client.project.create({ data: { id: foreignId, name: "Foreign project", ownerId: actorId } });
    await client.projectFile.create({ data: { id: fileId, projectId, name: "po.pdf", mimeType: "application/pdf", size: 1, data: Buffer.from([1]) } });
    let bytesRead = 0;
    const reader: AiScopeReader = {
      actor: (id) => client.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true } }),
      project: async (id) => {
        const project = await client.project.findUnique({ where: { id }, select: { id: true, ownerId: true, members: { select: { userId: true } } } });
        return project && { id: project.id, ownerId: project.ownerId, memberIds: project.members.map((member) => member.userId) };
      },
      source: async (ref, id) => {
        const file = await client.projectFile.findFirst({ where: { id: ref.id, projectId: id }, select: { name: true, mimeType: true, createdAt: true } });
        return file && { ...ref, projectId: id, name: file.name, mimeType: file.mimeType,
          version: file.createdAt.toISOString(), authorityStatus: "UPLOADED", immutable: false, businessKey: null };
      },
    };
    const store: AiSourceStore = {
      readBytes: async (source) => {
        bytesRead++;
        const file = await client.projectFile.findFirst({ where: { id: source.id, projectId: source.projectId }, select: { data: true } });
        if (!file?.data) throw new AiSourceNotFoundError();
        return file.data;
      },
      findRevision: (kind, id, version, sha256) => client.aiSourceRevision.findUnique({
        where: { originKind_originId_originVersion_sha256: { originKind: kind, originId: id, originVersion: version, sha256 } },
        select: { id: true, sha256: true },
      }),
      createRevision: (input) => client.aiSourceRevision.create({ data: {
        ...input, snapshotBytes: input.snapshotBytes ? Buffer.from(input.snapshotBytes) : null,
      }, select: { id: true, sha256: true } }),
    };

    const request = { projectId, sourceIds: [`PROJECT_FILE:${fileId}`], purpose: "DOCUMENT_EXTRACTION" };
    const scope = await resolveAiReadScope(actorId, request, reader);
    const first = await snapshotSelectedAiSources(actorId, scope.sources, store);
    assert.equal(bytesRead, 1);
    await assert.rejects(() => resolveAiReadScope(actorId, { ...request, projectId: foreignId }, reader), AiSourceNotFoundError);
    assert.equal(bytesRead, 1);
    await client.projectFile.update({ where: { id: fileId }, data: { data: Buffer.from([2]) } });
    const second = await snapshotSelectedAiSources(actorId, scope.sources, store);
    assert.notEqual(first[0].id, second[0].id);
    const firstStored = await client.aiSourceRevision.findUniqueOrThrow({ where: { id: first[0].id }, select: { snapshotBytes: true } });
    assert.deepEqual([...firstStored.snapshotBytes ?? []], [1]);
  });
});

test("explicit run is reused only for the same authorized source and disappears on access revocation", async () => {
  await withPhase15TestSchema("migrate", async ({ client, schemaName, databaseUrl }) => {
    const ownerId = `owner-${schemaName}`;
    const actorId = `member-${schemaName}`;
    const projectId = `run-project-${schemaName}`;
    const fileId = `run-file-${schemaName}`;
    const previous = Object.fromEntries(["DATABASE_URL", "AI_ENABLED", "AI_PROVIDER", "OPENAI_API_KEY",
      "AI_GENERATION_MODEL", "AI_EMBEDDING_MODEL", "AI_TIMEOUT_MS", "AI_MAX_OUTPUT_TOKENS", "AI_MAX_CONCURRENCY"]
      .map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl, AI_ENABLED: "true", AI_PROVIDER: "openai", OPENAI_API_KEY: "offline-test-only",
      AI_GENERATION_MODEL: "gpt-6-luna", AI_EMBEDDING_MODEL: "text-embedding-3-small",
      AI_TIMEOUT_MS: "1000", AI_MAX_OUTPUT_TOKENS: "100", AI_MAX_CONCURRENCY: "1",
    });
    try {
      await client.user.createMany({ data: [
        { id: ownerId, email: `${schemaName}-owner@example.invalid`, name: "Owner", passwordHash: "unused" },
        { id: actorId, email: `${schemaName}-member@example.invalid`, name: "Member", passwordHash: "unused", role: "ACCOUNT" },
      ] });
      await client.project.create({ data: { id: projectId, name: "Run project", ownerId } });
      await client.projectMember.create({ data: { projectId, userId: actorId } });
      await client.projectFile.create({ data: { id: fileId, projectId, name: "po.pdf",
        mimeType: "application/pdf", size: 1, data: Buffer.from([1]) } });
      const command = { intent: "ANALYZE", task: "DOCUMENT_EXTRACTION", sourceIds: [`PROJECT_FILE:${fileId}`] };
      const first = await createAiRun(actorId, projectId, command);
      assert.equal(first.reused, false);
      const repeated = await createAiRun(actorId, projectId, command);
      assert.equal(repeated.id, first.id);
      assert.equal(repeated.reused, true);
      const linked = await client.aiRunSource.count({ where: { runId: first.id } });
      assert.equal(linked, 1);
      await client.projectFile.update({ where: { id: fileId }, data: { data: Buffer.from([2]) } });
      const changed = await createAiRun(actorId, projectId, command);
      assert.notEqual(changed.id, first.id);
      await client.projectMember.delete({ where: { projectId_userId: { projectId, userId: actorId } } });
      await assert.rejects(() => readAiRun(actorId, projectId, first.id), AiSourceNotFoundError);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
