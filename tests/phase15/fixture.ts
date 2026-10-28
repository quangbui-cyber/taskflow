import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

export const PHASE15_TEST_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:55439/costflow_test";

const PHASE15_SCHEMA_PATTERN = /^phase15_[a-z0-9_]+$/;
const taskflowRoot = path.resolve(import.meta.dirname, "../..");
const prismaCli = path.join(taskflowRoot, "node_modules/prisma/build/index.js");

export const PHASE15_TABLES = [
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

const REQUIRED_UNIQUE_INDEX_FRAGMENTS = [
  '"originKind", "originId", "originVersion", sha256',
  '"scopeKey", "runType", "idempotencyKey"',
  '"scopeKey", "idempotencyKey"',
  '"structureFingerprint", "adapterVersion"',
] as const;

const REQUIRED_FOREIGN_KEY_FRAGMENTS = [
  'FOREIGN KEY ("runId", "scopeKey")',
  'FOREIGN KEY ("sourceRevisionId", "scopeKey")',
  'FOREIGN KEY ("publicationId", "scopeKey")',
] as const;

function databaseName(url: URL) {
  return url.pathname.replace(/^\//, "");
}

function assertPinnedBaseDatabaseUrl(rawUrl: string | undefined) {
  if (!rawUrl) throw new Error("Phase 15 requires COSTFLOW_TEST_DATABASE_URL.");
  const url = new URL(rawUrl);
  const isPinned =
    url.protocol === "postgresql:" &&
    url.username === "postgres" &&
    url.hostname === "127.0.0.1" &&
    url.port === "55439" &&
    databaseName(url) === "costflow_test" &&
    url.search === "";
  if (!isPinned) {
    throw new Error(
      "Phase 15 base database is restricted to postgresql://postgres@127.0.0.1:55439/costflow_test.",
    );
  }
}

export function assertPhase15SchemaDatabaseUrl(rawUrl: string | undefined) {
  if (!rawUrl) throw new Error("Phase 15 requires a disposable schema URL.");
  const url = new URL(rawUrl);
  const schema = url.searchParams.get("schema");
  const hasOnlySchema = [...url.searchParams.keys()].every((key) => key === "schema");
  const isPinned =
    url.protocol === "postgresql:" &&
    url.username === "postgres" &&
    url.hostname === "127.0.0.1" &&
    url.port === "55439" &&
    databaseName(url) === "costflow_test" &&
    schema !== null &&
    PHASE15_SCHEMA_PATTERN.test(schema) &&
    hasOnlySchema;
  if (!isPinned) {
    throw new Error(
      "Phase 15 automation is restricted to costflow_test with a phase15_* schema.",
    );
  }
}

function redactCommandLog(output: string, schemaName: string) {
  const database = new URL(PHASE15_TEST_DATABASE_URL).pathname.slice(1);
  return `DATABASE=${database} SCHEMA=${schemaName}\n${output.replaceAll(PHASE15_TEST_DATABASE_URL, "[PINNED_DATABASE]")}`;
}

export async function inspectPhase15Schema(client: PrismaClient) {
  const tables = await client.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name::text AS table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = ANY(${[...PHASE15_TABLES]}::text[])
    ORDER BY table_name
  `;
  const indexes = await client.$queryRaw<Array<{ indexdef: string }>>`
    SELECT indexdef::text AS indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = ANY(${[...PHASE15_TABLES]}::text[])
  `;
  const foreignKeys = await client.$queryRaw<Array<{ definition: string }>>`
    SELECT pg_get_constraintdef(constraint_row.oid)::text AS definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
    WHERE namespace_row.nspname = current_schema()
      AND table_row.relname = ANY(${[...PHASE15_TABLES]}::text[])
      AND constraint_row.contype = 'f'
  `;
  const tableNames = new Set(tables.map((row) => row.table_name));
  const indexText = indexes.map((row) => row.indexdef).join("\n");
  const foreignKeyText = foreignKeys.map((row) => row.definition).join("\n");
  return {
    missingTables: PHASE15_TABLES.filter((table) => !tableNames.has(table)),
    missingUniqueIndexes: REQUIRED_UNIQUE_INDEX_FRAGMENTS.filter(
      (fragment) => !indexText.includes(fragment),
    ),
    missingForeignKeys: REQUIRED_FOREIGN_KEY_FRAGMENTS.filter(
      (fragment) => !foreignKeyText.includes(fragment),
    ),
  };
}

export async function withPhase15TestSchema<T>(
  mode: "migrate" | "push",
  run: (context: {
    client: PrismaClient;
    schemaName: string;
    databaseUrl: string;
    commandLog: string;
  }) => Promise<T>,
): Promise<T> {
  const baseUrl = process.env.COSTFLOW_TEST_DATABASE_URL;
  assertPinnedBaseDatabaseUrl(baseUrl);

  const schemaName = `phase15_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = `${PHASE15_TEST_DATABASE_URL}?schema=${schemaName}`;
  assertPhase15SchemaDatabaseUrl(databaseUrl);

  const admin = new Pool({ connectionString: PHASE15_TEST_DATABASE_URL });
  let client: PrismaClient | undefined;
  let primaryError: unknown;
  try {
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    const args =
      mode === "push"
        ? [prismaCli, "db", "push"]
        : [prismaCli, "migrate", "deploy"];
    const result = spawnSync(process.execPath, args, {
      cwd: taskflowRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    });
    const rawLog = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const commandLog = redactCommandLog(rawLog, schemaName);
    if (result.status !== 0) {
      throw new Error(`Phase 15 prisma ${mode} failed.\n${commandLog}`);
    }
    if (/accept-data-loss|data loss|destructive change/i.test(rawLog)) {
      throw new Error(`Phase 15 prisma ${mode} reported a destructive change.`);
    }

    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    return await run({ client, schemaName, databaseUrl, commandLog });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await client?.$disconnect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    const residue = await admin.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1",
      [schemaName],
    );
    await admin.end();
    if (residue.rowCount !== 0 && primaryError === undefined) {
      throw new Error(`Phase 15 disposable schema cleanup failed: ${schemaName}`);
    }
  }
}
