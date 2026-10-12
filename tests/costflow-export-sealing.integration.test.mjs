import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const PINNED_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withMigratedSchema(run) {
  const schemaName = `phase10_export_seal_${randomUUID().replaceAll("-", "")}`;
  const disposableUrl = `${PINNED_DATABASE_URL}?schema=${schemaName}`;
  const admin = new PrismaClient({ datasources: { db: { url: PINNED_DATABASE_URL } } });
  let client;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: disposableUrl },
      encoding: "utf8",
      stdio: "pipe",
    });
    process.env.DATABASE_URL = disposableUrl;
    client = new PrismaClient({ datasources: { db: { url: disposableUrl } } });
    const projection = await import(`../lib/costflow/exportSourceProjection.ts?schema=${schemaName}`);
    await run({ client, projection });
  } finally {
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
}

async function fixture(client, label = "seal") {
  const suffix = `${label}-${randomUUID()}`;
  const owner = await client.user.create({ data: { id: `owner-${suffix}`, email: `${suffix}@example.test`, name: "Owner", passwordHash: "test", role: "ACCOUNT" } });
  const project = await client.project.create({ data: { id: `project-${suffix}`, name: "Seal", ownerId: owner.id } });
  return { owner, project };
}

function input(projectId, overrides = {}) {
  return {
    projectId,
    family: "QUOTATION",
    sourceKind: "QUOTATION",
    sourceId: "quote-1",
    sourceVersion: 1,
    approvalAttemptId: "finalize-quote-1",
    approvedSnapshotId: null,
    signingState: "UNSIGNED",
    payload: { title: "Quotation v1", rows: [{ id: "line-1", description: "Public line" }] },
    lines: [{ id: "line-1", rawNet: "100", rawVat: "8", rawGross: "108", vatPercent: "8" }],
    ...overrides,
  };
}

test("insert-once seal is idempotent and conflicts on the same exact source", () => withMigratedSchema(async ({ client, projection }) => {
  const { project } = await fixture(client, "idempotent");
  const first = await client.$transaction(tx => projection.sealExportSourceProjection(tx, input(project.id)));
  const replay = await client.$transaction(tx => projection.sealExportSourceProjection(tx, input(project.id)));
  assert.equal(replay.id, first.id);
  assert.equal(replay.projectionHash, first.projectionHash);
  await assert.rejects(
    client.$transaction(tx => projection.sealExportSourceProjection(tx, input(project.id, { payload: { title: "Changed" } }))),
    /xung đột|conflict/i,
  );
  assert.equal(await client.settlementExportSourceProjection.count({ where: { projectId: project.id } }), 1);
}));

test("concurrent identical delivery creates one row and same-family siblings coexist", () => withMigratedSchema(async ({ client, projection }) => {
  const { project } = await fixture(client, "concurrent");
  const [left, right] = await Promise.all([
    client.$transaction(tx => projection.sealExportSourceProjection(tx, input(project.id))),
    client.$transaction(tx => projection.sealExportSourceProjection(tx, input(project.id))),
  ]);
  assert.equal(left.id, right.id);
  await client.$transaction(tx => projection.sealExportSourceProjection(tx, input(project.id, { sourceId: "quote-2", sourceVersion: 2, approvalAttemptId: "finalize-quote-2" })));
  assert.equal(await client.settlementExportSourceProjection.count({ where: { projectId: project.id, family: "QUOTATION" } }), 2);
}));

test("failed sealing rolls back its producer transaction and creates no audit", () => withMigratedSchema(async ({ client, projection }) => {
  const { owner, project } = await fixture(client, "rollback");
  await assert.rejects(client.$transaction(async tx => {
    await tx.costFlowHistory.create({ data: { projectId: project.id, version: 1, actorId: owner.id, action: "FINALIZE", snapshot: { quote: "created" } } });
    await projection.sealExportSourceProjection(tx, input(project.id, { authoritativeTotals: { net: "100", vat: "8", gross: "110" } }));
  }), /-1, 0 hoặc \+1/);
  assert.equal(await client.costFlowHistory.count({ where: { projectId: project.id } }), 0);
  assert.equal(await client.settlementExportSourceProjection.count({ where: { projectId: project.id } }), 0);
  assert.equal(await client.settlementExportAudit.count({ where: { projectId: project.id } }), 0);
}));

test("legacy sealing is fail-closed and does not mutate approval, cash, lock or close axes", () => withMigratedSchema(async ({ client, projection }) => {
  const { project } = await fixture(client, "legacy");
  const before = {
    decisions: await client.workflowDecision.count(),
    cash: await client.costFlowCash.count(),
    locks: await client.settlementLock.count(),
    close: await client.financialCloseEvent.count(),
  };
  const blocked = await client.$transaction(tx => projection.sealLegacyExportSourceProjection(tx, {
    projectId: project.id,
    family: "DNTU",
    sourceKind: "ADVANCE",
    sourceId: "missing",
    sourceVersion: 1,
  }));
  assert.equal(blocked.status, "BLOCKED");
  assert.match(blocked.reason, /source|nguồn|attempt|identity/i);
  assert.deepEqual({
    decisions: await client.workflowDecision.count(),
    cash: await client.costFlowCash.count(),
    locks: await client.settlementLock.count(),
    close: await client.financialCloseEvent.count(),
  }, before);
  assert.equal(await client.settlementExportSourceProjection.count(), 0);
}));
