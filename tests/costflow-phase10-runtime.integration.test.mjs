import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const PINNED_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/costflow_test";
const root = path.resolve(import.meta.dirname, "..");

async function withSchema(run) {
  const schemaName = `phase10_runtime_${randomUUID().replaceAll("-", "")}`;
  const url = `${PINNED_DATABASE_URL}?schema=${schemaName}`;
  const admin = new PrismaClient({ datasources: { db: { url: PINNED_DATABASE_URL } } });
  let client;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    client = new PrismaClient({ datasources: { db: { url } } });
    await run(client);
  } finally {
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    const rows = await admin.$queryRawUnsafe(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${schemaName}'`);
    assert.equal(rows.length, 0, "disposable runtime schema must be removed");
    await admin.$disconnect();
  }
}

function source(projectId, version = 1, adjustment = 0) {
  return {
    projectId, family: "DNTT", sourceKind: "VENDOR_PAYMENT", sourceId: `payment-${version}`, sourceVersion: version,
    approvalAttemptId: `attempt-${version}`, approvedSnapshotId: null, signingState: "UNSIGNED",
    authoritativeTotals: { net: "100", vat: "8", gross: String(108 + adjustment) },
    payload: { title: `Payment ${version}`, paymentLines: [{ id: "line-1", description: "Exact payment" }] },
    lines: [{ id: "line-1", rawNet: "100", rawVat: "8", rawGross: String(108 + adjustment), vatPercent: "8" }],
  };
}

test("migrated runtime enforces exact sealing, artifact transitions, retry and tamper rejection", () => withSchema(async client => {
  const suffix = randomUUID();
  const actor = await client.user.create({ data: { id: `actor-${suffix}`, email: `${suffix}@example.test`, name: "Runtime actor", passwordHash: "test", role: "ACCOUNT" } });
  const project = await client.project.create({ data: { id: `project-${suffix}`, name: "Runtime", ownerId: actor.id } });
  const sealing = await import(`../lib/costflow/exportSourceProjection.ts?runtime=${suffix}`);
  const exporting = await import(`../lib/costflow/export.ts?runtime=${suffix}`);
  const security = await import(`../lib/costflow/settlementSecurity.ts?runtime=${suffix}`);

  await assert.rejects(client.$transaction(tx => exporting.resolveSealedExportProjection(tx, source(project.id))), /seal|projection/i);
  assert.equal(await client.settlementExportAudit.count(), 0);
  await assert.rejects(client.$transaction(tx => sealing.sealExportSourceProjection(tx, source(project.id, 9, 2))), /-1, 0 hoặc \+1/);
  assert.equal(await client.settlementExportSourceProjection.count(), 0);

  const sealed = await client.$transaction(tx => sealing.sealExportSourceProjection(tx, source(project.id)));
  const replay = await client.$transaction(tx => sealing.sealExportSourceProjection(tx, source(project.id)));
  assert.equal(replay.id, sealed.id);
  const reservation = await client.$transaction(tx => security.reserveSettlementExportArtifact(tx, { sourceProjection: sealed, format: "PDF", createdById: actor.id }));
  await client.$transaction(tx => security.failSettlementExportArtifact(tx, reservation.audit.id, reservation.reservationToken));
  const retried = await client.$transaction(tx => security.reserveSettlementExportArtifact(tx, { sourceProjection: sealed, format: "PDF", createdById: actor.id }));
  assert.equal(retried.audit.artifactStatus, "RESERVED");
  assert.notEqual(retried.reservationToken, reservation.reservationToken);
  const bytes = Buffer.from(`%PDF-1.4\n${sealed.projectionHash}\n%%EOF`, "utf8");
  const finalized = await client.$transaction(tx => security.finalizeSettlementExportArtifact(tx, { auditId: retried.audit.id, reservationToken: retried.reservationToken, bytes }));
  const stored = await security.readFinalizedSettlementExportArtifact(client, finalized.id);
  assert.deepEqual(Buffer.from(stored.bytes), bytes);
  await client.settlementExportAudit.update({ where: { id: finalized.id }, data: { artifactBytes: Buffer.alloc(bytes.length, 0x71) } });
  await assert.rejects(security.readFinalizedSettlementExportArtifact(client, finalized.id), /tamper|hash|bytes/i);
}));
