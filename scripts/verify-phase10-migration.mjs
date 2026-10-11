import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const PINNED_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const MIGRATION = "20261011090000_phase10_settlement_dossier";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = path.join(root, ".codex-tmp", "phase10-migration-before.json");
const mode = process.argv.includes("--before") ? "before" : process.argv.includes("--after") ? "after" : null;
if (!mode) throw new Error("Use --before or --after.");
if (process.env.DATABASE_URL !== PINNED_URL) throw new Error(`Refusing Phase 10 migration verification outside ${PINNED_URL}`);

const expectedTables = [
  "ProjectSettlementDossier",
  "ProjectSettlementVersion",
  "SettlementRecipientObligation",
  "SettlementCashAllocation",
  "SettlementLock",
  "SettlementEvidence",
  "FinancialCloseRequest",
  "FinancialCloseEvent",
  "SettlementExportAudit",
];
const producerTables = [
  "Project",
  "WorkflowRequest",
  "CostFlowCash",
  "CostFlowCashAllocation",
  "AdvanceApplication",
  "ActualCostApplication",
  "ActualCostApproval",
  "WorkflowApprovedSnapshot",
  "WorkflowSigningEvent",
];

function migrationNames() {
  return readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function verifyLexicalOrder() {
  const names = migrationNames();
  assert.equal(names.at(-1), MIGRATION, `${MIGRATION} must be the final lexical migration`);
  assert.ok(names.indexOf(MIGRATION) > names.findLastIndex(name => name.startsWith("20261010_phase9_")));
  return names.length;
}

async function readProducerSnapshot(client) {
  const counts = {};
  for (const table of producerTables) {
    const [row] = await client.$queryRawUnsafe(`SELECT COUNT(*)::text AS count FROM "${table}"`);
    counts[table] = row.count;
  }
  const columns = await client.$queryRawUnsafe(`
    SELECT table_name AS "tableName", column_name AS "columnName", data_type AS "dataType",
           is_nullable AS nullable, COALESCE(column_default, '') AS "columnDefault"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('ActualCostApplication', 'AdvanceApplication')
    ORDER BY table_name, ordinal_position
  `);
  const actualCostStates = await client.$queryRawUnsafe(`
    SELECT "state", COUNT(*)::text AS count
    FROM "ActualCostApplication"
    GROUP BY "state"
    ORDER BY "state"
  `);
  return { counts, columns, actualCostStates };
}

async function readPhase10Schema(client, schemaName = "public") {
  const tables = await client.$queryRawUnsafe(`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = $1 AND table_name = ANY($2::text[])
    ORDER BY table_name
  `, schemaName, expectedTables);
  const constraints = await client.$queryRawUnsafe(`
    SELECT conname AS name, contype AS type, confdeltype AS "deleteType",
           pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE connamespace = $1::regnamespace
      AND conrelid IN (SELECT oid FROM pg_class WHERE relnamespace = $1::regnamespace)
  `, schemaName);
  const indexes = await client.$queryRawUnsafe(`
    SELECT indexname AS name
    FROM pg_indexes
    WHERE schemaname = $1
  `, schemaName);
  return { tables: tables.map(row => row.tableName), constraints, indexes: indexes.map(row => row.name) };
}

function assertPhase10Schema(readback) {
  assert.deepEqual(readback.tables, [...expectedTables].sort());
  const byName = new Map(readback.constraints.map(row => [row.name, row]));
  for (const name of [
    "SettlementLock_source_xor_check",
    "SettlementLock_advance_cash_check",
    "ProjectSettlementVersion_replacement_check",
    "ProjectSettlementVersion_supersedesId_fkey",
    "SettlementExportAudit_approvedSnapshotId_fkey",
  ]) assert.ok(byName.has(name), `missing constraint ${name}`);
  const phase10ForeignKeys = readback.constraints.filter(row => row.type === "f" && expectedTables.some(table => row.name.startsWith(`${table}_`)));
  assert.ok(phase10ForeignKeys.length >= 20, "expected Phase 10 foreign-key provenance graph");
  for (const foreignKey of phase10ForeignKeys) assert.equal(foreignKey.deleteType, "r", `${foreignKey.name} must use Restrict`);
  for (const name of [
    "SettlementRecipientObligation_dossierVersionId_recipientKey_key",
    "SettlementCashAllocation_projectId_idempotencyKey_key",
    "ProjectSettlementVersion_projectId_attemptId_key",
    "FinancialCloseRequest_projectId_attemptId_key",
    "SettlementExportAudit_projectId_idempotencyKey_key",
  ]) assert.ok(readback.indexes.includes(name), `missing index ${name}`);
}

async function verifyFreshSchema(admin) {
  const schemaName = `phase10_verify_${randomUUID().replaceAll("-", "")}`;
  const disposableUrl = `${PINNED_URL}?schema=${schemaName}`;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: disposableUrl },
      encoding: "utf8",
      stdio: "pipe",
    });
    const readback = await readPhase10Schema(admin, schemaName);
    assertPhase10Schema(readback);
    return schemaName;
  } finally {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  }
}

const client = new PrismaClient({ datasources: { db: { url: PINNED_URL } } });
try {
  const [database] = await client.$queryRawUnsafe("SELECT current_database() AS name");
  assert.equal(database?.name, "taskflow");
  const migrationCount = verifyLexicalOrder();
  const producer = await readProducerSnapshot(client);

  if (mode === "before") {
    const existing = await readPhase10Schema(client);
    assert.equal(existing.tables.length, 0, "Phase 10 tables already exist before guarded deploy");
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify({ database: database.name, migration: MIGRATION, producer }, null, 2));
    console.log(JSON.stringify({ ok: true, mode, migrationCount, producerCounts: producer.counts }, null, 2));
  } else {
    const before = JSON.parse(readFileSync(snapshotPath, "utf8"));
    assert.equal(before.database, "taskflow");
    assert.equal(before.migration, MIGRATION);
    assert.deepEqual(producer, before.producer, "producer rows, lifecycle states, or columns changed during Phase 10 migration");
    const [applied] = await client.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "_prisma_migrations"
      WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    `, MIGRATION);
    assert.equal(applied.count, 1, "Phase 10 migration is not recorded exactly once");
    const readback = await readPhase10Schema(client);
    assertPhase10Schema(readback);
    const freshSchema = process.argv.includes("--fresh-schema-readback") ? await verifyFreshSchema(client) : null;
    if (process.argv.includes("--verify-lexical-order")) verifyLexicalOrder();
    console.log(JSON.stringify({
      ok: true,
      mode,
      migrationCount,
      producerCounts: producer.counts,
      phase10Tables: readback.tables,
      freshSchemaReadback: freshSchema ? "passed-and-removed" : "not-requested",
    }, null, 2));
  }
} finally {
  await client.$disconnect();
}
