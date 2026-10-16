import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { migrateLegacySuppliers } from "../lib/costflow/supplierMigration.ts";

const PINNED_URL = "postgresql://postgres@127.0.0.1:55439/costflow_test";
const MIGRATION = "20261016090000_phase14_supplier_master";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = path.join(root, ".codex-tmp", "phase14-supplier-migration-before.json");
const mode = process.argv.includes("--before") ? "before" : process.argv.includes("--after") ? "after" : null;
if (!mode) throw new Error("Use --before or --after.");
if (process.env.DATABASE_URL !== PINNED_URL) throw new Error(`Refusing Phase 14 migration verification outside ${PINNED_URL}`);

const supplierTables = [
  "Supplier",
  "SupplierVersion",
  "SupplierBankAccount",
  "SupplierBankAccountVersion",
  "SupplierEvidence",
  "SupplierVerification",
  "LegacySupplierAlias",
];
const historicalTables = [
  "Project",
  "CostFlowWorkspace",
  "WorkflowRequest",
  "PaymentRequestLine",
  "CostFlowCash",
  "ActualCostLine",
  "ActualCostVersion",
  "ProjectSettlementDossier",
  "ProjectSettlementVersion",
];

function verifyLexicalOrder() {
  const names = readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  assert.equal(names.at(-1), MIGRATION, `${MIGRATION} must be the final lexical migration`);
  return names.length;
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function historicalSnapshot(client, selectedTables = historicalTables, schemaName = "public") {
  const existingRows = await client.$queryRawUnsafe(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])`, schemaName, selectedTables);
  const existing = new Set(existingRows.map(row => row.name));
  const counts = {};
  for (const table of selectedTables.filter(name => existing.has(name))) {
    const [row] = await client.$queryRawUnsafe(`SELECT COUNT(*)::text AS count FROM "${schemaName}"."${table}"`);
    counts[table] = row.count;
  }
  const workspaceRows = existing.has("CostFlowWorkspace") ? await client.$queryRawUnsafe(`SELECT "projectId", "version", "data" FROM "${schemaName}"."CostFlowWorkspace" ORDER BY "projectId"`) : [];
  const paymentRows = existing.has("WorkflowRequest") ? await client.$queryRawUnsafe(`SELECT "id", "projectId", "kind", "state", "payload" FROM "${schemaName}"."WorkflowRequest" WHERE "module" = 'COSTFLOW' ORDER BY "id"`) : [];
  const cashRows = existing.has("CostFlowCash") ? await client.$queryRawUnsafe(`SELECT "id", "projectId", "requestId", "recipientKey", "amount", "evidenceId" FROM "${schemaName}"."CostFlowCash" ORDER BY "id"`) : [];
  return { counts, workspaceHash: stableHash(workspaceRows), paymentHash: stableHash(paymentRows), cashHash: stableHash(cashRows) };
}

async function readSupplierSchema(client, schemaName = "public") {
  const tables = await client.$queryRawUnsafe(`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = $1 AND table_name = ANY($2::text[])
    ORDER BY table_name
  `, schemaName, supplierTables);
  const constraints = await client.$queryRawUnsafe(`
    SELECT conname AS name, contype AS type, confdeltype AS "deleteType"
    FROM pg_constraint
    WHERE connamespace = $1::regnamespace
      AND conrelid IN (SELECT oid FROM pg_class WHERE relnamespace = $1::regnamespace AND relname = ANY($2::text[]))
  `, schemaName, supplierTables);
  const indexes = await client.$queryRawUnsafe(`SELECT indexname AS name FROM pg_indexes WHERE schemaname = $1 AND tablename = ANY($2::text[])`, schemaName, supplierTables);
  return { tables: tables.map(row => row.tableName), constraints, indexes: indexes.map(row => row.name) };
}

function assertSupplierSchema(readback) {
  assert.deepEqual(readback.tables, [...supplierTables].sort());
  const restrictForeignKeys = readback.constraints.filter(row => row.type === "f");
  assert.ok(restrictForeignKeys.length >= 18, "expected the supplier provenance foreign-key graph");
  for (const foreignKey of restrictForeignKeys) assert.equal(foreignKey.deleteType, "r", `${foreignKey.name} must use Restrict`);
  for (const name of [
    "Supplier_taxCodeKey_key",
    "SupplierVersion_supplierId_version_key",
    "SupplierBankAccount_one_primary_active_per_supplier",
    "SupplierBankAccountVersion_bankAccountId_version_key",
    "LegacySupplierAlias_projectId_legacyBeneficiaryId_key",
    "LegacySupplierAlias_projectId_legacyRecipientKey_key",
  ]) assert.ok(readback.indexes.includes(name), `missing index ${name}`);
}

async function verifyFreshSchema(admin) {
  const schemaName = `phase14_verify_${randomUUID().replaceAll("-", "")}`;
  const url = `${PINNED_URL}?schema=${schemaName}`;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
    const readback = await readSupplierSchema(admin, schemaName);
    assertSupplierSchema(readback);
    const [applied] = await admin.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${schemaName}"."_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`, MIGRATION);
    assert.equal(applied.count, 1, "fresh schema must record Phase 14 migration exactly once");
    return "passed-and-removed";
  } finally {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  }
}

const client = new PrismaClient({ datasources: { db: { url: PINNED_URL } } });
try {
  const [database] = await client.$queryRawUnsafe("SELECT current_database() AS name");
  assert.equal(database?.name, "costflow_test");
  const migrationCount = verifyLexicalOrder();
  const savedBefore = mode === "after" ? JSON.parse(readFileSync(snapshotPath, "utf8")) : null;
  const historical = await historicalSnapshot(client, savedBefore ? Object.keys(savedBefore.historical.counts) : historicalTables);
  const existing = await readSupplierSchema(client);

  if (mode === "before") {
    assert.equal(existing.tables.length, 0, "Phase 14 supplier tables already exist before guarded deploy");
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify({ database: database.name, migration: MIGRATION, historical }, null, 2));
    console.log(JSON.stringify({ ok: true, mode, migrationCount, historicalCounts: historical.counts }, null, 2));
  } else {
    const before = savedBefore;
    assert.equal(before.database, "costflow_test");
    assert.equal(before.migration, MIGRATION);
    assert.deepEqual(historical, before.historical, "Phase 14 deploy changed historical finance rows or snapshots");
    let backfill = null;
    let rerun = null;
    let aliasCount = null;
    if (existing.tables.length === supplierTables.length) {
      assertSupplierSchema(existing);
      const [applied] = await client.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`, MIGRATION);
      assert.equal(applied.count, 1, "Phase 14 migration must be recorded exactly once");
      backfill = await migrateLegacySuppliers(client);
      rerun = await migrateLegacySuppliers(client);
      assert.equal(rerun.migrated, 0, "supplier backfill rerun must be idempotent");
      assert.equal(rerun.existingAliases, backfill.migrated + backfill.existingAliases);
      const aliases = await client.legacySupplierAlias.findMany({ select: { legacyBeneficiaryId: true, legacyRecipientKey: true } });
      assert.ok(aliases.every(alias => alias.legacyRecipientKey === `VENDOR:${alias.legacyBeneficiaryId}`));
      aliasCount = aliases.length;
    } else {
      assert.equal(existing.tables.length, 0, "public schema contains only part of the supplier migration");
    }
    const fresh = process.argv.includes("--fresh-schema-readback") ? await verifyFreshSchema(client) : "not-requested";
    console.log(JSON.stringify({ ok: true, mode, migrationCount, historicalCounts: historical.counts, publicSchema: existing.tables.length ? "migrated" : "unchanged-unmanaged-baseline", backfill, rerun, aliasCount, freshSchemaReadback: fresh }, null, 2));
  }
} finally {
  await client.$disconnect();
}
