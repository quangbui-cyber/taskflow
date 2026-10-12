import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const PINNED_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const root = path.resolve(import.meta.dirname, "..");
const families = ["QUOTATION", "CUSTOMER_ACCEPTANCE", "DNTU", "DNTT", "DNHTU", "PROJECT_SETTLEMENT"];

async function withSchema(run) {
  const schemaName = `phase10_export_identity_${randomUUID().replaceAll("-", "")}`;
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
    await admin.$disconnect();
  }
}

async function fixture(client) {
  const suffix = randomUUID();
  const actor = await client.user.create({ data: { id: `actor-${suffix}`, email: `${suffix}@example.test`, name: "Exporter", passwordHash: "test", role: "ACCOUNT" } });
  const project = await client.project.create({ data: { id: `project-${suffix}`, name: "Exact export", ownerId: actor.id } });
  return { actor, project };
}

function input(projectId, family, version = 1) {
  const sourceKind = family === "DNTU" ? "ADVANCE" : family === "DNTT" ? "VENDOR_PAYMENT" : family === "DNHTU" ? "REIMBURSEMENT" : family;
  return {
    projectId, family, sourceKind, sourceId: `${family.toLowerCase()}-${version}`, sourceVersion: version,
    approvalAttemptId: `attempt-${family}-${version}`, approvedSnapshotId: null, signingState: "UNSIGNED",
    payload: { title: `${family} v${version}`, rows: [{ id: "line-a", description: `${family} exact line`, netAmount: "100", vatAmount: "8", grossAmount: "108" }] },
    lines: [{ id: "line-a", rawNet: "100", rawVat: "8", rawGross: "108", vatPercent: "8" }],
  };
}

test("all six families consume only their exact sealed tuple and render deterministic PDF bytes", () => withSchema(async client => {
  const { actor, project } = await fixture(client);
  const sealing = await import("../lib/costflow/exportSourceProjection.ts");
  const exports = await import("../lib/costflow/export.ts");
  const pdf = await import("../lib/costflow/pdfExport.ts");
  for (const family of families) {
    const source = input(project.id, family);
    await client.$transaction(tx => sealing.sealExportSourceProjection(tx, source));
    const resolved = await client.$transaction(tx => exports.resolveSealedExportProjection(tx, source));
    assert.equal(resolved.sourceProjection.projectionHash.length, 64);
    assert.deepEqual(resolved.projection.totals, { rawNet: "100", rawVat: "8", rawGross: "108", net: "100", vat: "8", gross: "108" });
    const left = pdf.renderCostFlowPdf({ projection: resolved.projection, sourceProjection: resolved.sourceProjection, publicVerificationToken: undefined });
    const right = pdf.renderCostFlowPdf({ projection: resolved.projection, sourceProjection: resolved.sourceProjection, publicVerificationToken: undefined });
    assert.equal(Buffer.from(left).subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual(left, right);
    assert.match(Buffer.from(left).toString("latin1"), new RegExp(`${family}.*${source.sourceVersion}`, "s"));
  }
  assert.equal(await client.settlementExportAudit.count({ where: { projectId: project.id } }), 0);
  void actor;
}));

test("reservation finalizes exact bytes once and rejects tampered stored artifacts", () => withSchema(async client => {
  const { actor, project } = await fixture(client);
  const sealing = await import("../lib/costflow/exportSourceProjection.ts");
  const security = await import("../lib/costflow/settlementSecurity.ts");
  const source = input(project.id, "DNTT", 2);
  const sealed = await client.$transaction(tx => sealing.sealExportSourceProjection(tx, source));
  const reservation = await client.$transaction(tx => security.reserveSettlementExportArtifact(tx, { sourceProjection: sealed, format: "PDF", createdById: actor.id }));
  assert.equal(reservation.audit.artifactStatus, "RESERVED");
  assert.equal(reservation.audit.artifactBytes, null);
  const bytes = Buffer.from(`%PDF-1.4\n${sealed.projectionHash}\n%%EOF`, "utf8");
  const finalized = await client.$transaction(tx => security.finalizeSettlementExportArtifact(tx, { auditId: reservation.audit.id, reservationToken: reservation.reservationToken, bytes }));
  assert.equal(finalized.artifactStatus, "FINALIZED");
  assert.equal(finalized.fileSha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(finalized.artifactByteLength, bytes.length);
  const replay = await client.$transaction(tx => security.finalizeSettlementExportArtifact(tx, { auditId: reservation.audit.id, reservationToken: reservation.reservationToken, bytes }));
  assert.equal(replay.id, finalized.id);
  await client.settlementExportAudit.update({ where: { id: finalized.id }, data: { artifactBytes: Buffer.alloc(bytes.length, 0x78) } });
  await assert.rejects(security.readFinalizedSettlementExportArtifact(client, finalized.id), /hash|bytes|tamper/i);
}));

test("unsealed tuple fails before reservation and routes do not recompute or select latest", () => withSchema(async client => {
  const { project } = await fixture(client);
  const exports = await import("../lib/costflow/export.ts");
  await assert.rejects(client.$transaction(tx => exports.resolveSealedExportProjection(tx, input(project.id, "DNTU"))), /seal|projection|nguồn/i);
  assert.equal(await client.settlementExportAudit.count(), 0);
  const xlsxRoute = await readFile(new URL("../app/api/projects/[id]/costflow/export/[type]/route.ts", import.meta.url), "utf8");
  assert.match(xlsxRoute, /sourceKind/);
  assert.match(xlsxRoute, /sourceId/);
  assert.match(xlsxRoute, /sourceVersion/);
  assert.match(xlsxRoute, /resolveSealedExportProjection/);
  assert.doesNotMatch(xlsxRoute, /calculateTotals|calculateLineCost|orderBy:\s*\[?\{?\s*(?:version|createdAt):\s*"desc"/);
}));
