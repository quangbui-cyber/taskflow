import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Pool } from "pg";

import {
  PHASE15_TEST_DATABASE_URL,
  assertPhase15SchemaDatabaseUrl,
  inspectPhase15Schema,
  withPhase15TestSchema,
} from "./phase15/fixture";

const EXPECTED_MODELS = [
  "AiSourceRevision",
  "AiSourceSpan",
  "AiRun",
  "AiRunSource",
  "AiCandidateField",
  "AiFinding",
  "AiReviewEvent",
  "AiApplicationReceipt",
  "AiKnowledgePublication",
  "AiKnowledgeChunk",
  "AiMappingAdapter",
] as const;

const MIGRATION_URL = new URL(
  "../prisma/migrations/20261028120000_phase15_ai_controlled_layer/migration.sql",
  import.meta.url,
);

function assertDisposableCommandLog(commandLog: string, schemaName: string) {
  assert.match(schemaName, /^phase15_[a-f0-9]{32}$/);
  assert.match(commandLog, new RegExp(schemaName));
  assert.match(commandLog, /costflow_test/);
  assert.doesNotMatch(commandLog, /\/taskflow\b|@(?:localhost|[^\s@/]+\.)[^\s:/]+/i);
  assert.doesNotMatch(commandLog, /(?:db\s+seed|migrate\s+reset|db\s+reset)/i);
}

async function assertDisposableSchemaRemoved(schemaName: string) {
  const admin = new Pool({ connectionString: PHASE15_TEST_DATABASE_URL });
  try {
    const residue = await admin.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM information_schema.schemata WHERE schema_name = $1",
      [schemaName],
    );
    assert.equal(residue.rows[0]?.count, "0");
  } finally {
    await admin.end();
  }
}

test("Phase 15 migration is additive and defines the complete provenance spine", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(MIGRATION_URL, "utf8"),
  ]);

  for (const model of EXPECTED_MODELS) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
    assert.match(migration, new RegExp(`CREATE TABLE "${model}"`));
  }

  assert.doesNotMatch(
    migration,
    /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|ALTER\s+TABLE[^;]*\bDROP\b/i,
  );
  assert.doesNotMatch(schema, /rawPrompt|rawModelOutput|modelOutput\s+Json/i);
  assert.match(schema, /@@unique\(\[originKind, originId, originVersion, sha256\]\)/);
  assert.match(schema, /@@unique\(\[scopeKey, runType, idempotencyKey\]\)/);
  assert.match(schema, /@@unique\(\[scopeKey, idempotencyKey\]\)/);
  assert.match(schema, /@@unique\(\[structureFingerprint, adapterVersion\]\)/);
  assert.match(migration, /ON DELETE RESTRICT/g);
});

test("Phase 15 database guard rejects every non-disposable target", () => {
  assert.throws(() => assertPhase15SchemaDatabaseUrl(undefined));
  assert.throws(() =>
    assertPhase15SchemaDatabaseUrl(
      "postgresql://postgres@127.0.0.1:55439/taskflow?schema=phase15_bad",
    ),
  );
  assert.throws(() =>
    assertPhase15SchemaDatabaseUrl(
      "postgresql://postgres@localhost:55439/costflow_test?schema=phase15_bad",
    ),
  );
  assert.throws(() =>
    assertPhase15SchemaDatabaseUrl(
      "postgresql://postgres@127.0.0.1:5432/costflow_test?schema=phase15_bad",
    ),
  );
  assert.throws(() =>
    assertPhase15SchemaDatabaseUrl(
      "postgresql://postgres@127.0.0.1:55439/costflow_test?schema=public",
    ),
  );
  assert.doesNotThrow(() =>
    assertPhase15SchemaDatabaseUrl(`${PHASE15_TEST_DATABASE_URL}?schema=phase15_contract`),
  );
});

test("migrate deploy preserves scoped idempotency, project lineage and published-only retrieval", async () => {
  let disposedSchema = "";
  await withPhase15TestSchema("migrate", async ({ client, schemaName, commandLog }) => {
    disposedSchema = schemaName;
    assertDisposableCommandLog(commandLog, schemaName);

    const shape = await inspectPhase15Schema(client);
    assert.deepEqual(shape.missingTables, []);
    assert.deepEqual(shape.missingUniqueIndexes, []);
    assert.deepEqual(shape.missingForeignKeys, []);

    const suffix = schemaName.slice("phase15_".length);
    const actor = await client.user.create({
      data: {
        id: `actor-${suffix}`,
        email: `phase15-${suffix}@example.invalid`,
        name: "Phase 15 actor",
        passwordHash: "disabled-login",
      },
    });
    const projectA = await client.project.create({
      data: { id: `project-a-${suffix}`, name: "Phase 15 A", ownerId: actor.id },
    });
    const projectB = await client.project.create({
      data: { id: `project-b-${suffix}`, name: "Phase 15 B", ownerId: actor.id },
    });
    const scopeA = `PROJECT:${projectA.id}`;
    const scopeB = `PROJECT:${projectB.id}`;
    const sourceA = await client.aiSourceRevision.create({
      data: {
        projectId: projectA.id,
        scopeKey: scopeA,
        originKind: "PROJECT_FILE",
        originId: `file-a-${suffix}`,
        originVersion: "1",
        sha256: "a".repeat(64),
        filename: "source-a.pdf",
        mimeType: "application/pdf",
        byteLength: 10,
        authorityStatus: "CONFIRMED",
        createdById: actor.id,
      },
    });
    const sourceB = await client.aiSourceRevision.create({
      data: {
        projectId: projectB.id,
        scopeKey: scopeB,
        originKind: "PROJECT_FILE",
        originId: `file-b-${suffix}`,
        originVersion: "1",
        sha256: "b".repeat(64),
        filename: "source-b.pdf",
        mimeType: "application/pdf",
        byteLength: 10,
        authorityStatus: "CONFIRMED",
        createdById: actor.id,
      },
    });
    const run = await client.aiRun.create({
      data: {
        projectId: projectA.id,
        actorId: actor.id,
        scopeKey: scopeA,
        runType: "DOCUMENT_EXTRACTION",
        status: "COMPLETED",
        sourceBundleHash: "c".repeat(64),
        parserVersion: "pdf-v1",
        pipelineVersion: "extract-v1",
        promptVersion: "prompt-v1",
        configVersion: "config-v1",
        provider: "OFFLINE",
        model: "fixture",
        scopeVersion: "1",
        scopeHash: "d".repeat(64),
        idempotencyKey: `run-${suffix}`,
      },
    });
    await client.aiRunSource.create({
      data: { runId: run.id, sourceRevisionId: sourceA.id, scopeKey: scopeA, role: "PRIMARY" },
    });

    await assert.rejects(() =>
      client.aiRun.create({
        data: {
          projectId: projectA.id,
          actorId: actor.id,
          scopeKey: scopeA,
          runType: "DOCUMENT_EXTRACTION",
          status: "COMPLETED",
          sourceBundleHash: "e".repeat(64),
          parserVersion: "pdf-v1",
          pipelineVersion: "extract-v1",
          promptVersion: "prompt-v1",
          configVersion: "config-v1",
          provider: "OFFLINE",
          model: "fixture",
          scopeVersion: "1",
          scopeHash: "d".repeat(64),
          idempotencyKey: `run-${suffix}`,
        },
      }),
    );
    await assert.rejects(() =>
      client.aiRunSource.create({
        data: { runId: run.id, sourceRevisionId: sourceB.id, scopeKey: scopeA, role: "PRIMARY" },
      }),
    );
    await assert.rejects(() => client.aiSourceRevision.delete({ where: { id: sourceA.id } }));

    await assert.rejects(() =>
      client.$executeRawUnsafe(
        `INSERT INTO "AiKnowledgePublication" ("id", "sourceRevisionId", "scopeKey", "publicationVersion", "publishedById", "createdAt") VALUES ($1, $2, $3, 1, $4, CURRENT_TIMESTAMP)`,
        `publication-no-status-${suffix}`,
        sourceA.id,
        scopeA,
        actor.id,
      ),
    );
    const draftPublication = await client.aiKnowledgePublication.create({
      data: {
        sourceRevisionId: sourceA.id,
        scopeKey: scopeA,
        publicationVersion: 1,
        status: "DRAFT",
        publishedById: actor.id,
      },
    });
    const span = await client.aiSourceSpan.create({
      data: {
        sourceRevisionId: sourceA.id,
        scopeKey: scopeA,
        spanKind: "PAGE",
        pageNumber: 1,
        quote: "Synthetic policy text",
        normalizedText: "synthetic policy text",
        contentHash: "f".repeat(64),
      },
    });
    await client.aiKnowledgeChunk.create({
      data: {
        publicationId: draftPublication.id,
        sourceSpanId: span.id,
        scopeKey: scopeA,
        chunkIndex: 0,
        normalizedText: "synthetic policy text",
        contentHash: "f".repeat(64),
      },
    });
    const publishedChunks = await client.aiKnowledgeChunk.findMany({
      where: { publication: { status: "PUBLISHED" } },
    });
    assert.equal(publishedChunks.length, 0);
  });
  await assertDisposableSchemaRemoved(disposedSchema);
});

test("db push creates the same Phase 15 contract without destructive flags and cleans up", async () => {
  let disposedSchema = "";
  await withPhase15TestSchema("push", async ({ client, schemaName, commandLog }) => {
    disposedSchema = schemaName;
    assertDisposableCommandLog(commandLog, schemaName);

    const shape = await inspectPhase15Schema(client);
    assert.deepEqual(shape.missingTables, []);
    assert.deepEqual(shape.missingUniqueIndexes, []);
    assert.deepEqual(shape.missingForeignKeys, []);
  });
  await assertDisposableSchemaRemoved(disposedSchema);
});
