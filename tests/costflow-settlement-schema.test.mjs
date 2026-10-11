import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(import.meta.dirname, "..");
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const migrationName = "20261011090000_phase10_settlement_dossier";
const migrationPath = path.join(root, "prisma/migrations", migrationName, "migration.sql");
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

function migrationNames() {
  return readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function modelBlock(name) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `missing model ${name}`);
  return match[0];
}

test("Phase 10 migration sorts strictly after all existing migrations", () => {
  const names = migrationNames();
  assert.equal(names.at(-1), migrationName);
  assert.ok(names.indexOf(migrationName) > names.findLastIndex(name => name.startsWith("20261010_phase9_")));
  assert.equal(new Set(names).size, names.length);
});

test("schema keeps settlement lock separate from producer lifecycle state", () => {
  for (const model of expectedTables) assert.match(schema, new RegExp(`model ${model}\\s*\\{`));
  assert.match(schema, /model SettlementLock\s*\{[\s\S]*?actualCostApplicationId\s+String\?[\s\S]*?advanceApplicationId\s+String\?/);
  assert.match(schema, /actualCostApplication\s+ActualCostApplication\?[\s\S]*?onDelete: Restrict/);
  assert.match(schema, /advanceApplication\s+AdvanceApplication\?[\s\S]*?onDelete: Restrict/);
  assert.doesNotMatch(modelBlock("ActualCostApplication"), /@default\("SETTLED"\)/);
  assert.doesNotMatch(modelBlock("AdvanceApplication"), /\bstatus\s+String/);
});

test("migration enforces provenance, idempotency, replacement, and append-only audit constraints", () => {
  const sql = readFileSync(migrationPath, "utf8");
  for (const table of expectedTables) assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
  assert.match(sql, /SettlementLock_source_xor_check/);
  assert.match(sql, /SettlementLock_advance_cash_check/);
  assert.match(sql, /SettlementCashAllocation_projectId_idempotencyKey_key/);
  assert.match(sql, /SettlementRecipientObligation_dossierVersionId_recipientKey_key/);
  assert.match(sql, /ProjectSettlementVersion_supersedesId_fkey[\s\S]*?ON DELETE RESTRICT/);
  assert.match(sql, /SettlementExportAudit_approvedSnapshotId_fkey[\s\S]*?ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /UPDATE "(?:ActualCostApplication|AdvanceApplication)"[\s\S]*?SET[\s\S]*?SETTLED/i);
});

test("complete migration chain applies to a disposable schema and reads back Phase 10 constraints", { timeout: 120_000 }, async () => {
  const pinned = "postgresql://postgres@127.0.0.1:55439/taskflow";
  const schemaName = `phase10_${randomUUID().replaceAll("-", "")}`;
  const disposableUrl = `${pinned}?schema=${schemaName}`;
  const admin = new PrismaClient({ datasources: { db: { url: pinned } } });
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: disposableUrl },
      encoding: "utf8",
      stdio: "pipe",
    });
    const tables = await admin.$queryRawUnsafe(`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = ANY($2::text[])
      ORDER BY table_name
    `, schemaName, expectedTables);
    assert.deepEqual(tables.map(row => row.tableName), [...expectedTables].sort());
    const constraints = await admin.$queryRawUnsafe(`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE connamespace = $1::regnamespace
        AND conrelid IN (
          SELECT c.oid FROM pg_class c WHERE c.relnamespace = $1::regnamespace
        )
    `, schemaName);
    const byName = new Map(constraints.map(row => [row.name, row]));
    for (const name of [
      "SettlementLock_source_xor_check",
      "SettlementLock_advance_cash_check",
      "ProjectSettlementVersion_supersedesId_fkey",
      "SettlementExportAudit_approvedSnapshotId_fkey",
    ]) assert.ok(byName.has(name), `missing ${name}`);
    assert.match(byName.get("ProjectSettlementVersion_supersedesId_fkey").definition, /ON DELETE RESTRICT/);
  } finally {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
});
