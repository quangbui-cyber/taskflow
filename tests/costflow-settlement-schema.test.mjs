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

async function withMigratedSchema(run) {
  const pinned = "postgresql://postgres@127.0.0.1:55439/taskflow";
  const schemaName = `phase10_${randomUUID().replaceAll("-", "")}`;
  const disposableUrl = `${pinned}?schema=${schemaName}`;
  const admin = new PrismaClient({ datasources: { db: { url: pinned } } });
  let client;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: disposableUrl },
      encoding: "utf8",
      stdio: "pipe",
    });
    client = new PrismaClient({ datasources: { db: { url: disposableUrl } } });
    await run(client, schemaName);
  } finally {
    if (client) await client.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
}

async function insertSettlementFixture(client) {
  const ids = {
    actor: `user_${randomUUID()}`,
    project: `project_${randomUUID()}`,
    request: `request_${randomUUID()}`,
    snapshot: `snapshot_${randomUUID()}`,
    dossier: `dossier_${randomUUID()}`,
    version: `version_${randomUUID()}`,
  };
  await client.$executeRawUnsafe(
    `INSERT INTO "User" ("id", "email", "name", "passwordHash") VALUES ($1, $2, 'Schema actor', 'hash')`,
    ids.actor,
    `${ids.actor}@example.test`,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "Project" ("id", "name", "ownerId") VALUES ($1, 'Schema project', $2)`,
    ids.project,
    ids.actor,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "WorkflowRequest" ("id", "projectId", "module", "kind", "title", "creatorId", "cashAssigneeId", "steps", "payload", "updatedAt")
     VALUES ($1, $2, 'COSTFLOW', 'PROJECT_SETTLEMENT', 'Settlement', $3, $3, '[]'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP)`,
    ids.request,
    ids.project,
    ids.actor,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "WorkflowApprovedSnapshot" ("id", "requestId", "version", "mode", "evidenceState", "projection", "projectionSha256", "attestationKeyId", "attestation")
     VALUES ($1, $2, 1, 'DIGITAL', 'CHO_KY', '{}'::jsonb, $3, 'test-key', 'attestation')`,
    ids.snapshot,
    ids.request,
    "a".repeat(64),
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ProjectSettlementDossier" ("id", "projectId", "createdById") VALUES ($1, $2, $3)`,
    ids.dossier,
    ids.project,
    ids.actor,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ProjectSettlementVersion" ("id", "projectId", "dossierId", "requestId", "version", "attemptId", "canonicalHash", "createdById")
     VALUES ($1, $2, $3, $4, 1, 'attempt-1', $5, $6)`,
    ids.version,
    ids.project,
    ids.dossier,
    ids.request,
    "b".repeat(64),
    ids.actor,
  );
  return ids;
}

async function captureFailure(failures, label, operation) {
  try {
    await operation();
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
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

test("fully migrated schema accepts runtime vocabulary and exact gap identities", { timeout: 120_000 }, async () => {
  await withMigratedSchema(async client => {
    const ids = await insertSettlementFixture(client);
    const failures = [];

    for (const [index, direction] of ["REFUND", "ADDITIONAL", "BALANCED"].entries()) {
      await captureFailure(failures, `obligation ${direction}`, () => client.$executeRawUnsafe(
        `INSERT INTO "SettlementRecipientObligation"
          ("id", "projectId", "dossierVersionId", "recipientKey", "recipientType", "direction", "approvedAcGross", "disbursedAdvance", "amountDue")
         VALUES ($1, $2, $3, $4, 'EMPLOYEE', $5, '100', '50', $6)`,
        `obligation_${direction}_${randomUUID()}`,
        ids.project,
        ids.version,
        `recipient-${index}`,
        direction,
        direction === "BALANCED" ? "0" : "50",
      ));
    }

    for (const [attempt, decisions] of [
      ["close-approve", ["REQUESTED", "APPROVE"]],
      ["close-return", ["REQUESTED", "RETURN"]],
      ["close-reject", ["REQUESTED", "REJECT"]],
    ]) {
      const closeRequestId = `close_${randomUUID()}`;
      await client.$executeRawUnsafe(
        `INSERT INTO "FinancialCloseRequest" ("id", "projectId", "dossierId", "attemptId", "action", "reason", "requestedById")
         VALUES ($1, $2, $3, $4, 'CLOSE', 'schema test', $5)`,
        closeRequestId,
        ids.project,
        ids.dossier,
        attempt,
        ids.actor,
      );
      for (const decision of decisions) {
        await captureFailure(failures, `close event ${decision}`, () => client.$executeRawUnsafe(
          `INSERT INTO "FinancialCloseEvent" ("id", "closeRequestId", "decision", "reason", "actorId", "eventHash")
           VALUES ($1, $2, $3, 'schema test', $4, $5)`,
          `event_${randomUUID()}`,
          closeRequestId,
          decision,
          ids.actor,
          randomUUID().replaceAll("-", "").repeat(2),
        ));
      }
    }

    await captureFailure(failures, "version exact approval binding", () => client.$executeRawUnsafe(
      `UPDATE "ProjectSettlementVersion"
       SET "sourceManifestHash" = $2, "approvedAttemptId" = 'attempt-1', "approvedSnapshotId" = $3, "approvedProjectionHash" = $4
       WHERE "id" = $1`,
      ids.version,
      "c".repeat(64),
      ids.snapshot,
      "d".repeat(64),
    ));

    await captureFailure(failures, "open correction lifecycle", () => client.$executeRawUnsafe(
      `INSERT INTO "SettlementCorrectionAttempt"
        ("id", "projectId", "dossierId", "baseVersionId", "requestedFieldScopes", "requestedLockScopes", "requestedById", "reason", "stage", "status")
       VALUES ($1, $2, $3, $4, '["RECIPIENT"]'::jsonb, '["PAID"]'::jsonb, $5, 'wrong recipient', 'REQUESTED', 'OPEN')`,
      `correction_${randomUUID()}`,
      ids.project,
      ids.dossier,
      ids.version,
      ids.actor,
    ));

    await captureFailure(failures, "exact export projection", () => client.$executeRawUnsafe(
      `INSERT INTO "SettlementExportSourceProjection"
        ("id", "projectId", "dossierVersionId", "family", "sourceKind", "sourceId", "sourceVersion", "authoritativeNet", "authoritativeVat", "authoritativeGross", "roundingAdjustment", "vatLineAssignment", "projectionHash")
       VALUES ($1, $2, $3, 'DNTT', 'PAYMENT_REQUEST', 'request-a', 1, '100', '8', '108', 0, '{"lineId":"line-a"}'::jsonb, $4)`,
      `projection_${randomUUID()}`,
      ids.project,
      ids.version,
      "e".repeat(64),
    ));

    await captureFailure(failures, "structured finalized export audit", () => client.$executeRawUnsafe(
      `INSERT INTO "SettlementExportAudit"
        ("id", "projectId", "dossierVersionId", "family", "format", "canonicalHash", "approvedSnapshotId", "idempotencyKey", "createdById",
         "approvalAttemptId", "sourceKind", "sourceId", "sourceVersion", "artifactStatus", "artifactBytes", "reservationToken", "fileSha256")
       VALUES ($1, $2, $3, 'DNTT', 'PDF', $4, $5, $6, $7, 'attempt-1', 'PAYMENT_REQUEST', 'request-a', 1, 'FINALIZED', $8, $9, $10)`,
      `audit_${randomUUID()}`,
      ids.project,
      ids.version,
      "f".repeat(64),
      ids.snapshot,
      `audit-key-${randomUUID()}`,
      ids.actor,
      Buffer.from("deterministic-pdf"),
      `reservation-${randomUUID()}`,
      "1".repeat(64),
    ));

    assert.deepEqual(failures, [], `database contract failures:\n${failures.join("\n")}`);
  });
});
