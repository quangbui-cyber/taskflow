import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const PINNED_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const MIGRATION = "20261012090000_phase10_gap_contracts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = path.join(root, ".codex-tmp", "phase10-gap-migration-before.json");
const mode = process.argv.includes("--before") ? "before" : process.argv.includes("--after") ? "after" : null;

if (!mode) throw new Error("Use --before or --after.");
if (process.env.DATABASE_URL !== PINNED_URL) {
  throw new Error(`Refusing Phase 10 gap migration verification outside ${PINNED_URL}`);
}

const legacyTables = [
  "ProjectSettlementDossier",
  "ProjectSettlementVersion",
  "SettlementRecipientObligation",
  "SettlementCashAllocation",
  "SettlementLock",
  "SettlementEvidence",
  "FinancialCloseRequest",
  "FinancialCloseEvent",
  "SettlementExportAudit",
  "ActualCostApplication",
  "AdvanceApplication",
  "CostFlowCash",
  "CostFlowCashAllocation",
];

function migrationNames() {
  return readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

async function readLegacySnapshot(client) {
  const counts = {};
  for (const table of legacyTables) {
    const [row] = await client.$queryRawUnsafe(`SELECT COUNT(*)::text AS count FROM "${table}"`);
    counts[table] = row.count;
  }
  const obligations = await client.$queryRawUnsafe(`
    SELECT "id", "projectId", "dossierVersionId", "recipientKey", "direction",
           "approvedAcGross", "disbursedAdvance", "amountDue"
    FROM "SettlementRecipientObligation"
    ORDER BY "id"
  `);
  const closeEvents = await client.$queryRawUnsafe(`
    SELECT "id", "closeRequestId", "decision", "eventHash"
    FROM "FinancialCloseEvent"
    ORDER BY "id"
  `);
  return { counts, obligations, closeEvents };
}

async function readGapContract(client, schemaName = "public") {
  const constraints = await client.$queryRawUnsafe(`
    SELECT conname AS name, contype AS type, confdeltype AS "deleteType",
           pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE connamespace = $1::regnamespace
      AND conrelid IN (SELECT oid FROM pg_class WHERE relnamespace = $1::regnamespace)
  `, schemaName);
  const indexes = await client.$queryRawUnsafe(`
    SELECT indexname AS name, indexdef AS definition
    FROM pg_indexes
    WHERE schemaname = $1
  `, schemaName);
  const columns = await client.$queryRawUnsafe(`
    SELECT table_name AS "tableName", column_name AS "columnName", is_nullable AS nullable
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name IN ('ProjectSettlementVersion', 'FinancialCloseRequest', 'SettlementExportAudit',
                         'SettlementCorrectionAttempt', 'SettlementCorrectionObligationPair',
                         'SettlementAdvanceManifestRow', 'SettlementExportSourceProjection')
    ORDER BY table_name, ordinal_position
  `, schemaName);
  return { constraints, indexes, columns };
}

function assertGapContract(readback) {
  const constraints = new Map(readback.constraints.map(row => [row.name, row]));
  const indexes = new Map(readback.indexes.map(row => [row.name, row]));
  for (const name of [
    "SettlementRecipientObligation_direction_check",
    "FinancialCloseEvent_decision_check",
    "SettlementCorrectionAttempt_terminal_check",
    "SettlementExportSourceProjection_rounding_check",
    "SettlementExportAudit_artifact_check",
    "SettlementExportAudit_file_sha256_check",
  ]) assert.ok(constraints.has(name), `missing constraint ${name}`);
  assert.match(constraints.get("SettlementRecipientObligation_direction_check").definition, /REFUND.*ADDITIONAL.*BALANCED/);
  assert.match(constraints.get("FinancialCloseEvent_decision_check").definition, /REQUESTED.*APPROVE.*RETURN.*REJECT/);
  assert.ok(indexes.has("SettlementCorrectionAttempt_one_open_per_project_idx"));
  assert.match(indexes.get("SettlementCorrectionAttempt_one_open_per_project_idx").definition, /terminalAt.*IS NULL/);
  assert.ok(indexes.has("SettlementExportSourceProjection_exact_source_key"));
  for (const foreignKey of readback.constraints.filter(row => row.type === "f" && /Settlement(?:Correction|Advance|Export)/.test(row.name))) {
    assert.equal(foreignKey.deleteType, "r", `${foreignKey.name} must use Restrict`);
  }
}

async function verifyFreshSchema(admin) {
  const schemaName = `phase10_gap_verify_${randomUUID().replaceAll("-", "")}`;
  const url = `${PINNED_URL}?schema=${schemaName}`;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      stdio: "pipe",
    });
    const readback = await readGapContract(admin, schemaName);
    assertGapContract(readback);
  } finally {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  }
}

const client = new PrismaClient({ datasources: { db: { url: PINNED_URL } } });
try {
  const [database] = await client.$queryRawUnsafe("SELECT current_database() AS name");
  assert.equal(database?.name, "taskflow");
  const names = migrationNames();
  if (mode === "before") {
    assert.equal(names.at(-1), MIGRATION, `${MIGRATION} must be the final lexical migration`);
    const [applied] = await client.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count FROM "_prisma_migrations"
      WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    `, MIGRATION);
    assert.equal(applied.count, 0, `${MIGRATION} is already applied before guarded deploy`);
    const legacy = await readLegacySnapshot(client);
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify({ database: database.name, migration: MIGRATION, legacy }, null, 2));
    console.log(JSON.stringify({ ok: true, mode, legacyCounts: legacy.counts }, null, 2));
  } else {
    assert.equal(names.at(-1), MIGRATION, `${MIGRATION} must be the final lexical migration`);
    const before = JSON.parse(readFileSync(snapshotPath, "utf8"));
    assert.equal(before.database, "taskflow");
    assert.deepEqual(await readLegacySnapshot(client), before.legacy, "legacy Phase 10 or producer data changed");
    const [applied] = await client.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count FROM "_prisma_migrations"
      WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    `, MIGRATION);
    assert.equal(applied.count, 1, `${MIGRATION} must be applied exactly once`);
    assertGapContract(await readGapContract(client));
    if (process.argv.includes("--fresh-schema-readback")) await verifyFreshSchema(client);
    console.log(JSON.stringify({ ok: true, mode, legacyCounts: before.legacy.counts, freshSchemaReadback: "passed" }, null, 2));
  }
} finally {
  await client.$disconnect();
}
