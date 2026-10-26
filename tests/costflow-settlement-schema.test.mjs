import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(import.meta.dirname, "..");
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const migrationName = "20261012090000_phase10_gap_contracts";
const migrationPath = path.join(root, "prisma/migrations", migrationName, "migration.sql");
const latestMigrationName = "20261012100000_phase10_draft_manifest_hash";
const latestMigrationPath = path.join(root, "prisma/migrations", latestMigrationName, "migration.sql");
const baselineMigrationPath = path.join(root, "prisma/migrations/20261011090000_phase10_settlement_dossier/migration.sql");
const baselineTables = [
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
const gapTables = [
  "SettlementAdvanceManifestRow",
  "SettlementCorrectionAttempt",
  "SettlementCorrectionObligationPair",
  "SettlementExportSourceProjection",
];
const expectedTables = [...baselineTables, ...gapTables];

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

function hasPostgresCode(code) {
  return error => error?.meta?.code === code || String(error).includes(`Code: \`${code}\``);
}

test("Phase 10 gap migrations preserve their strict internal order", () => {
  const names = migrationNames();
  assert.ok(names.includes(latestMigrationName));
  assert.ok(names.indexOf(latestMigrationName) > names.indexOf(migrationName));
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
  const latestSql = readFileSync(latestMigrationPath, "utf8");
  const baselineSql = readFileSync(baselineMigrationPath, "utf8");
  for (const table of gapTables) assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
  assert.match(baselineSql, /SettlementLock_source_xor_check/);
  assert.match(baselineSql, /SettlementLock_advance_cash_check/);
  assert.match(baselineSql, /SettlementCashAllocation_projectId_idempotencyKey_key/);
  assert.match(baselineSql, /SettlementRecipientObligation_dossierVersionId_recipientKey_key/);
  assert.match(baselineSql, /ProjectSettlementVersion_supersedesId_fkey[\s\S]*?ON DELETE RESTRICT/);
  assert.match(sql, /SettlementCorrectionAttempt_one_open_per_project_idx[\s\S]*?terminalAt/);
  assert.match(sql, /SettlementExportSourceProjection_exact_source_key/);
  assert.match(sql, /SettlementExportAudit_file_sha256_check/);
  assert.match(latestSql, /ProjectSettlementVersion_source_manifest_hash_check/);
  assert.match(latestSql, /approvedAttemptId[\s\S]*?approvedSnapshotId[\s\S]*?approvedProjectionHash/);
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
    const obligationIds = new Map();

    for (const [index, direction] of ["REFUND", "ADDITIONAL", "BALANCED"].entries()) {
      const obligationId = `obligation_${direction}_${randomUUID()}`;
      obligationIds.set(direction, obligationId);
      await captureFailure(failures, `obligation ${direction}`, () => client.$executeRawUnsafe(
        `INSERT INTO "SettlementRecipientObligation"
          ("id", "projectId", "dossierVersionId", "recipientKey", "recipientType", "direction", "approvedAcGross", "disbursedAdvance", "amountDue")
         VALUES ($1, $2, $3, $4, 'EMPLOYEE', $5, '100', '50', $6)`,
        obligationId,
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

    const correctionId = `correction_${randomUUID()}`;
    await captureFailure(failures, "open correction lifecycle", () => client.$executeRawUnsafe(
      `INSERT INTO "SettlementCorrectionAttempt"
        ("id", "projectId", "dossierId", "baseVersionId", "requestedFieldScopes", "requestedLockScopes", "requestedById", "reason", "stage", "status")
       VALUES ($1, $2, $3, $4, '["RECIPIENT"]'::jsonb, '["PAID"]'::jsonb, $5, 'wrong recipient', 'REQUESTED', 'OPEN')`,
      correctionId,
      ids.project,
      ids.dossier,
      ids.version,
      ids.actor,
    ));

    const projectionId = `projection_${randomUUID()}`;
    await captureFailure(failures, "exact export projection", () => client.$executeRawUnsafe(
      `INSERT INTO "SettlementExportSourceProjection"
        ("id", "projectId", "dossierVersionId", "family", "sourceKind", "sourceId", "sourceVersion", "authoritativeNet", "authoritativeVat", "authoritativeGross", "roundingAdjustment", "vatLineAssignment", "projectionHash")
       VALUES ($1, $2, $3, 'DNTT', 'PAYMENT_REQUEST', 'request-a', 1, '100', '8', '108', 0, '{"lineId":"line-a"}'::jsonb, $4)`,
      projectionId,
      ids.project,
      ids.version,
      "e".repeat(64),
    ));

    await captureFailure(failures, "structured finalized export audit", () => client.$executeRawUnsafe(
      `INSERT INTO "SettlementExportAudit"
        ("id", "projectId", "dossierVersionId", "family", "format", "canonicalHash", "approvedSnapshotId", "idempotencyKey", "createdById",
         "approvalAttemptId", "sourceProjectionId", "sourceKind", "sourceId", "sourceVersion", "artifactStatus", "artifactBytes", "reservationToken", "fileSha256")
       VALUES ($1, $2, $3, 'DNTT', 'PDF', $4, $5, $6, $7, 'attempt-1', $8, 'PAYMENT_REQUEST', 'request-a', 1, 'FINALIZED', $9, $10, $11)`,
      `audit_${randomUUID()}`,
      ids.project,
      ids.version,
      "f".repeat(64),
      ids.snapshot,
      `audit-key-${randomUUID()}`,
      ids.actor,
      projectionId,
      Buffer.from("deterministic-pdf"),
      `reservation-${randomUUID()}`,
      "1".repeat(64),
    ));

    assert.deepEqual(failures, [], `database contract failures:\n${failures.join("\n")}`);

    await client.$executeRawUnsafe(
      `INSERT INTO "FinancialCloseRequest"
        ("id", "projectId", "dossierId", "dossierVersionId", "canonicalHash", "workspaceVersion", "attemptId", "action", "reason", "requestedById")
       VALUES ($1, $2, $3, $4, $5, 0, 'close-exact', 'CLOSE', 'exact binding', $6)`,
      `close_${randomUUID()}`, ids.project, ids.dossier, ids.version, "b".repeat(64), ids.actor,
    );

    const recipientKey = "recipient-1";
    const recipientSnapshotId = `recipient_${randomUUID()}`;
    const requestLineId = `line_${randomUUID()}`;
    const cashId = `cash_${randomUUID()}`;
    const sourceAllocationId = `allocation_${randomUUID()}`;
    const advanceApplicationId = `advance_${randomUUID()}`;
    await client.$executeRawUnsafe(
      `INSERT INTO "PaymentRecipientSnapshot"
        ("id", "projectId", "requestId", "recipientKey", "recipientType", "displayName", "totalAmount")
       VALUES ($1, $2, $3, $4, 'EMPLOYEE', 'Recipient', '50')`,
      recipientSnapshotId, ids.project, ids.request, recipientKey,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "PaymentRequestLine"
        ("id", "projectId", "requestId", "stableKey", "position", "description", "amount", "icRevisionId", "icLineId", "sourceSnapshot", "recipientKey", "evidenceManifest")
       VALUES ($1, $2, $3, 'line-1', 0, 'Advance line', '50', 'ic-r1', 'ic-l1', '{}'::jsonb, $4, '[]'::jsonb)`,
      requestLineId, ids.project, ids.request, recipientKey,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "CostFlowCash"
        ("id", "projectId", "requestId", "recipientKey", "direction", "channel", "amount", "reference", "idempotencyKey", "commandFingerprint", "allocations", "evidenceId", "occurredAt", "confirmedBy")
       VALUES ($1, $2, $3, $4, 'OUT', 'BANK', '50', $5, $6, 'fingerprint', '[]'::jsonb, 'evidence-ref', CURRENT_TIMESTAMP, $7)`,
      cashId, ids.project, ids.request, recipientKey, `ref-${randomUUID()}`, `cash-key-${randomUUID()}`, ids.actor,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "CostFlowCashAllocation"
        ("id", "projectId", "cashId", "requestId", "requestLineId", "recipientKey", "direction", "amount")
       VALUES ($1, $2, $3, $4, $5, $6, 'OUT', '50')`,
      sourceAllocationId, ids.project, cashId, ids.request, requestLineId, recipientKey,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "AdvanceApplication"
        ("id", "projectId", "advanceRequestId", "advanceLineId", "expenseId", "recipientKey", "amount", "createdBy")
       VALUES ($1, $2, $3, $4, 'expense-1', $5, '50', $6)`,
      advanceApplicationId, ids.project, ids.request, requestLineId, recipientKey, ids.actor,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "SettlementAdvanceManifestRow"
        ("id", "projectId", "dossierVersionId", "obligationId", "recipientKey", "advanceApplicationId", "sourceCashAllocationId")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      `manifest_${randomUUID()}`, ids.project, ids.version, obligationIds.get("ADDITIONAL"), recipientKey,
      advanceApplicationId, sourceAllocationId,
    );

    const secondProjectId = `project_${randomUUID()}`;
    const crossProjectAdvanceId = `advance_${randomUUID()}`;
    await client.$executeRawUnsafe(
      `INSERT INTO "AdvanceApplication"
        ("id", "projectId", "advanceRequestId", "advanceLineId", "expenseId", "recipientKey", "amount", "createdBy")
       VALUES ($1, $2, $3, $4, 'expense-2', $5, '50', $6)`,
      crossProjectAdvanceId, ids.project, ids.request, requestLineId, recipientKey, ids.actor,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "Project" ("id", "name", "ownerId") VALUES ($1, 'Other project', $2)`,
      secondProjectId, ids.actor,
    );
    await assert.rejects(() => client.$executeRawUnsafe(
      `INSERT INTO "SettlementAdvanceManifestRow"
        ("id", "projectId", "dossierVersionId", "obligationId", "recipientKey", "advanceApplicationId", "sourceCashAllocationId")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      `manifest_${randomUUID()}`, secondProjectId, ids.version, obligationIds.get("ADDITIONAL"), recipientKey,
      crossProjectAdvanceId, sourceAllocationId,
    ), hasPostgresCode("23503"));

    await assert.rejects(() => client.$executeRawUnsafe(
      `INSERT INTO "SettlementCorrectionAttempt"
        ("id", "projectId", "dossierId", "baseVersionId", "requestedFieldScopes", "requestedLockScopes", "requestedById", "reason", "stage", "status")
       VALUES ($1, $2, $3, $4, '["AMOUNT"]'::jsonb, '[]'::jsonb, $5, 'second open', 'REQUESTED', 'OPEN')`,
      `second_${randomUUID()}`, ids.project, ids.dossier, ids.version, ids.actor,
    ), hasPostgresCode("23505"));

    const correctionVersionId = `version_${randomUUID()}`;
    await client.$executeRawUnsafe(
      `INSERT INTO "ProjectSettlementVersion"
        ("id", "projectId", "dossierId", "requestId", "version", "attemptId", "canonicalHash", "createdById",
         "supersedesId", "replacementReason", "replacementActorId", "replacedAt")
       VALUES ($1, $2, $3, $4, 2, 'attempt-2', $5, $6, $7, 'correction', $6, CURRENT_TIMESTAMP)`,
      correctionVersionId, ids.project, ids.dossier, ids.request, "2".repeat(64), ids.actor, ids.version,
    );
    for (const stage of ["APPROVED", "VERSION_CREATED", "RECOVERY_PENDING", "PAYMENT_PENDING", "APPROVAL_PENDING", "SIGNING_PENDING"]) {
      await client.$executeRawUnsafe(
        `UPDATE "SettlementCorrectionAttempt"
         SET "stage" = $2, "correctionVersionId" = CASE WHEN $2 = 'VERSION_CREATED' THEN $3 ELSE "correctionVersionId" END
         WHERE "id" = $1`,
        correctionId, stage, correctionVersionId,
      );
      await assert.rejects(() => client.$executeRawUnsafe(
        `INSERT INTO "SettlementCorrectionAttempt"
          ("id", "projectId", "dossierId", "baseVersionId", "requestedFieldScopes", "requestedLockScopes", "requestedById", "reason", "stage", "status")
         VALUES ($1, $2, $3, $4, '["AMOUNT"]'::jsonb, '[]'::jsonb, $5, 'still exclusive', 'REQUESTED', 'OPEN')`,
        `second_${randomUUID()}`, ids.project, ids.dossier, ids.version, ids.actor,
      ), hasPostgresCode("23505"));
    }
    await assert.rejects(() => client.$executeRawUnsafe(
      `UPDATE "SettlementCorrectionAttempt" SET "stage" = 'COMPLETED', "status" = 'COMPLETED' WHERE "id" = $1`,
      correctionId,
    ), hasPostgresCode("23514"));
    await client.$executeRawUnsafe(
      `UPDATE "SettlementCorrectionAttempt" SET "stage" = 'COMPLETED', "status" = 'COMPLETED', "terminalAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      correctionId,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "SettlementCorrectionAttempt"
        ("id", "projectId", "dossierId", "baseVersionId", "requestedFieldScopes", "requestedLockScopes", "requestedById", "reason", "stage", "status")
       VALUES ($1, $2, $3, $4, '["AMOUNT"]'::jsonb, '[]'::jsonb, $5, 'new after terminal', 'REQUESTED', 'OPEN')`,
      `second_${randomUUID()}`, ids.project, ids.dossier, correctionVersionId, ids.actor,
    );

    const [cashBeforePair] = await client.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "CostFlowCash"`);
    await client.$executeRawUnsafe(
      `INSERT INTO "SettlementCorrectionObligationPair"
        ("id", "projectId", "correctionAttemptId", "originalObligationId", "recoveryObligationId", "correctedPaymentObligationId")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      `pair_${randomUUID()}`, ids.project, correctionId,
      obligationIds.get("BALANCED"), obligationIds.get("REFUND"), obligationIds.get("ADDITIONAL"),
    );
    const [cashAfterPair] = await client.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "CostFlowCash"`);
    assert.equal(cashAfterPair.count, cashBeforePair.count, "correction pairing must not mutate old cash");

    await assert.rejects(() => client.$executeRawUnsafe(
      `INSERT INTO "SettlementExportSourceProjection"
        ("id", "projectId", "dossierVersionId", "family", "sourceKind", "sourceId", "sourceVersion", "authoritativeNet", "authoritativeVat", "authoritativeGross", "roundingAdjustment", "vatLineAssignment", "projectionHash")
       VALUES ($1, $2, $3, 'DNTT', 'PAYMENT_REQUEST', 'request-b', 1, '100', '8', '108', 2, '{}'::jsonb, $4)`,
      `projection_${randomUUID()}`, ids.project, ids.version, "3".repeat(64),
    ), hasPostgresCode("23514"));
    await client.$executeRawUnsafe(
      `INSERT INTO "SettlementExportSourceProjection"
        ("id", "projectId", "dossierVersionId", "family", "sourceKind", "sourceId", "sourceVersion", "authoritativeNet", "authoritativeVat", "authoritativeGross", "roundingAdjustment", "vatLineAssignment", "projectionHash")
       VALUES ($1, $2, $3, 'DNTT', 'PAYMENT_REQUEST', 'request-b', 1, '200', '16', '216', -1, '{"lineId":"line-b"}'::jsonb, $4)`,
      `projection_${randomUUID()}`, ids.project, ids.version, "4".repeat(64),
    );
    await assert.rejects(() => client.$executeRawUnsafe(
      `INSERT INTO "SettlementExportSourceProjection"
        ("id", "projectId", "dossierVersionId", "family", "sourceKind", "sourceId", "sourceVersion", "authoritativeNet", "authoritativeVat", "authoritativeGross", "roundingAdjustment", "vatLineAssignment", "projectionHash")
       VALUES ($1, $2, $3, 'DNTT', 'PAYMENT_REQUEST', 'request-cross-project', 1, '1', '0', '1', 0, '{}'::jsonb, $4)`,
      `projection_${randomUUID()}`, secondProjectId, ids.version, "7".repeat(64),
    ), hasPostgresCode("23503"));
    await assert.rejects(() => client.$executeRawUnsafe(
      `INSERT INTO "SettlementExportSourceProjection"
        ("id", "projectId", "dossierVersionId", "family", "sourceKind", "sourceId", "sourceVersion", "authoritativeNet", "authoritativeVat", "authoritativeGross", "roundingAdjustment", "vatLineAssignment", "projectionHash")
       VALUES ($1, $2, $3, 'DNTT', 'PAYMENT_REQUEST', 'request-a', 1, '100', '8', '108', 0, '{}'::jsonb, $4)`,
      `projection_${randomUUID()}`, ids.project, ids.version, "5".repeat(64),
    ), hasPostgresCode("23505"));
    await assert.rejects(() => client.$executeRawUnsafe(
      `INSERT INTO "SettlementExportAudit"
        ("id", "projectId", "dossierVersionId", "family", "format", "canonicalHash", "approvedSnapshotId", "idempotencyKey", "createdById",
         "approvalAttemptId", "sourceProjectionId", "sourceKind", "sourceId", "sourceVersion", "artifactStatus", "artifactBytes", "reservationToken", "fileSha256")
       VALUES ($1, $2, $3, 'DNTT', 'PDF', $4, $5, $6, $7, 'attempt-1', $8, 'PAYMENT_REQUEST', 'request-a', 1, 'FINALIZED', NULL, 'reservation', 'bad')`,
      `audit_${randomUUID()}`, ids.project, ids.version, "6".repeat(64), ids.snapshot,
      `audit-key-${randomUUID()}`, ids.actor, projectionId,
    ), hasPostgresCode("23514"));
  });
});
