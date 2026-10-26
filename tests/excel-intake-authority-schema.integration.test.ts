import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

const CANONICAL_URL = "postgresql://postgres@127.0.0.1:55439/costflow_test";
const EXPECTED_TABLES = [
  "ExcelIntakePreviewSession",
  "ExcelIntakeOperationReceipt",
  "ExcelIntakeSourceEvidence",
] as const;

type SchemaState = "ABSENT" | "COMPLETE_COMPATIBLE" | "PARTIAL_INCOMPATIBLE";

function requireCanonicalDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const testDatabaseUrl = process.env.COSTFLOW_TEST_DATABASE_URL ?? "";
  assert.equal(databaseUrl, CANONICAL_URL, "DATABASE_URL must target exact costflow_test");
  assert.equal(testDatabaseUrl, CANONICAL_URL, "COSTFLOW_TEST_DATABASE_URL must target exact costflow_test");
  assert.equal(databaseUrl, testDatabaseUrl, "database variables must be identical");
}

async function inspectSchema(prisma: {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
}): Promise<SchemaState> {
  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name`,
    [...EXPECTED_TABLES],
  );
  if (tables.length === 0) return "ABSENT";
  if (tables.length !== EXPECTED_TABLES.length) return "PARTIAL_INCOMPATIBLE";

  const requiredColumns: Record<(typeof EXPECTED_TABLES)[number], string[]> = {
    ExcelIntakePreviewSession: ["id", "projectId", "actorId", "operationKind", "scopeKey", "draftId", "sourceSha256", "sourceBytes", "canonicalPayload", "displayPayload", "status", "expiresAt", "receiptId", "resultKind", "resultId"],
    ExcelIntakeOperationReceipt: ["id", "projectId", "previewSessionId", "idempotencyKey", "actorId", "operationKind", "canonicalFingerprint", "result", "linkedRecordKind", "linkedRecordId", "createdAt"],
    ExcelIntakeSourceEvidence: ["id", "projectId", "previewSessionId", "receiptId", "actorId", "operationKind", "filename", "size", "sha256", "data", "linkedRecordKind", "linkedRecordId", "createdAt"],
  };
  const columns = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; is_nullable: string }>>(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [...EXPECTED_TABLES],
  );
  for (const [table, names] of Object.entries(requiredColumns)) {
    for (const name of names) {
      if (!columns.some(column => column.table_name === table && column.column_name === name)) return "PARTIAL_INCOMPATIBLE";
    }
  }
  for (const nullable of ["sourceBytes", "canonicalPayload", "displayPayload"]) {
    if (!columns.some(column => column.table_name === "ExcelIntakePreviewSession" && column.column_name === nullable && column.is_nullable === "YES")) return "PARTIAL_INCOMPATIBLE";
  }

  const constraints = await prisma.$queryRawUnsafe<Array<{ definition: string }>>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('"ExcelIntakePreviewSession"'::regclass, '"ExcelIntakeOperationReceipt"'::regclass, '"ExcelIntakeSourceEvidence"'::regclass)`,
  );
  const definitions = constraints.map(value => value.definition).join("\n");
  if (!/UNIQUE \("projectId", "idempotencyKey"\)/.test(definitions)) return "PARTIAL_INCOMPATIBLE";
  if (!/FOREIGN KEY \("receiptId"\)/.test(definitions)) return "PARTIAL_INCOMPATIBLE";
  return "COMPLETE_COMPATIBLE";
}

test("authority schema contract is additive and keeps redaction payloads nullable", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261025170000_excel_intake_authority/migration.sql", import.meta.url), "utf8"),
  ]);
  for (const model of EXPECTED_TABLES) assert.match(schema, new RegExp(`model ${model} \\{`));
  assert.match(schema, /sourceBytes\s+Bytes\?/);
  assert.match(schema, /canonicalPayload\s+Json\?/);
  assert.match(schema, /displayPayload\s+Json\?/);
  assert.match(schema, /@@unique\(\[projectId, idempotencyKey\]\)/);
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|ALTER\s+TABLE[^;]*\bDROP\b/i);
});

test("authority live schema is exactly absent, complete-compatible or partial-incompatible", { skip: !process.env.EXCEL_AUTHORITY_SCHEMA_MODE }, async () => {
  requireCanonicalDatabaseUrl();
  const { prisma } = await import("../lib/prisma");
  try {
    const state = await inspectSchema(prisma);
    process.stdout.write(`EXCEL_AUTHORITY_SCHEMA_STATE=${state}\n`);
    if (process.env.EXCEL_AUTHORITY_SCHEMA_MODE === "inspect") return;
    assert.equal(state, "COMPLETE_COMPATIBLE");

    const prefix = `phase31-gap-authority-${randomUUID()}`;
    const actor = await prisma.user.create({ data: { name: prefix, email: `${prefix}@example.test`, passwordHash: "unused", role: "ACCOUNT" } });
    const project = await prisma.project.create({ data: { name: prefix, ownerId: actor.id, members: { create: { userId: actor.id } } } });
    try {
      const session = await prisma.excelIntakePreviewSession.create({ data: {
        projectId: project.id, actorId: actor.id, operationKind: "NEW_DRAFT", scopeKey: "NEW_DRAFT", sourceKind: "XLSX", sourceRevision: 1,
        sourceSha256: "a".repeat(64), sourceFilename: "source.xlsx", sourceSize: 4, sourceBytes: Buffer.from("xlsx"), canonicalFingerprint: "b".repeat(64),
        canonicalPayload: { rows: [] }, displayPayload: { rows: [] }, status: "ACTIVE", expiresAt: new Date(Date.now() + 60_000),
      } });
      const receipt = await prisma.excelIntakeOperationReceipt.create({ data: {
        projectId: project.id, previewSessionId: session.id, idempotencyKey: `${prefix}:receipt`, actorId: actor.id, operationKind: "NEW_DRAFT",
        canonicalFingerprint: "c".repeat(64), result: { draftId: `${prefix}:draft` }, linkedRecordKind: "PAIRED_DRAFT", linkedRecordId: `${prefix}:draft`,
      } });
      await assert.rejects(() => prisma.excelIntakeOperationReceipt.create({ data: {
        projectId: project.id, previewSessionId: session.id, idempotencyKey: `${prefix}:receipt`, actorId: actor.id, operationKind: "NEW_DRAFT",
        canonicalFingerprint: "c".repeat(64), result: {}, linkedRecordKind: "PAIRED_DRAFT", linkedRecordId: `${prefix}:draft`,
      } }));
      const evidence = await prisma.excelIntakeSourceEvidence.create({ data: {
        projectId: project.id, previewSessionId: session.id, receiptId: receipt.id, actorId: actor.id, operationKind: "NEW_DRAFT", filename: "source.xlsx",
        size: 4, sha256: "a".repeat(64), data: Buffer.from("xlsx"), linkedRecordKind: "PAIRED_DRAFT", linkedRecordId: `${prefix}:draft`,
      } });
      await prisma.excelIntakePreviewSession.update({ where: { id: session.id }, data: {
        status: "CONSUMED", sourceBytes: null, canonicalPayload: Prisma.DbNull, displayPayload: Prisma.DbNull, receiptId: receipt.id, resultKind: "PAIRED_DRAFT", resultId: `${prefix}:draft`, consumedAt: new Date(),
      } });
      const redacted = await prisma.excelIntakePreviewSession.findUniqueOrThrow({ where: { id: session.id } });
      assert.equal(redacted.sourceBytes, null);
      assert.equal(redacted.canonicalPayload, null);
      assert.equal(redacted.displayPayload, null);
      assert.equal(evidence.receiptId, receipt.id);
    } finally {
      await prisma.excelIntakeSourceEvidence.deleteMany({ where: { projectId: project.id } });
      await prisma.excelIntakeOperationReceipt.deleteMany({ where: { projectId: project.id } });
      await prisma.excelIntakePreviewSession.deleteMany({ where: { projectId: project.id } });
      await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
    const residue = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM "ExcelIntakePreviewSession" WHERE "scopeKey" LIKE 'phase31-gap-authority-%') + (SELECT COUNT(*) FROM "ExcelIntakeOperationReceipt" WHERE "idempotencyKey" LIKE 'phase31-gap-authority-%') AS count`,
    );
    assert.equal(Number(residue[0]?.count ?? 0), 0);
  } finally {
    await prisma.$disconnect();
  }
});

export { inspectSchema };
