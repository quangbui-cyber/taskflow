import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const PINNED_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const ORIGIN = "http://localhost:3017";
const root = path.resolve(import.meta.dirname, "..");
const families = [
  ["QUOTATION", "QUOTATION", "quotation"], ["CUSTOMER_ACCEPTANCE", "CUSTOMER_ACCEPTANCE", "customer-acceptance"],
  ["DNTU", "ADVANCE", "dntu"], ["DNTT", "VENDOR_PAYMENT", "dntt"], ["DNHTU", "REIMBURSEMENT", "dnhtu"],
  ["PROJECT_SETTLEMENT", "PROJECT_SETTLEMENT", "project-settlement"],
];
const familyByPath = new Map(families.map(([family, , route]) => [route, family]));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(3017, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

test("authenticated HTTP exports six exact XLSX/PDF artifacts and persists response bytes/hash", { timeout: 120000 }, async () => {
  const schemaName = `phase10_http_${randomUUID().replaceAll("-", "")}`;
  const url = `${PINNED_DATABASE_URL}?schema=${schemaName}`;
  const admin = new PrismaClient({ datasources: { db: { url: PINNED_DATABASE_URL } } });
  let client;
  let server;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    client = new PrismaClient({ datasources: { db: { url } } });
    const suffix = randomUUID();
    const actor = await client.user.create({ data: { id: `admin-${suffix}`, email: `${suffix}@example.test`, name: "HTTP admin", passwordHash: "test", role: "ADMIN" } });
    const outsider = await client.user.create({ data: { id: `outsider-${suffix}`, email: `out-${suffix}@example.test`, name: "Outsider", passwordHash: "test", role: "ACCOUNT" } });
    const project = await client.project.create({ data: { id: `project-${suffix}`, name: "HTTP exact export", ownerId: actor.id } });
    const sealing = await import(`../lib/costflow/exportSourceProjection.ts?http=${suffix}`);
    const exporting = await import(`../lib/costflow/export.ts?http=${suffix}`);
    const pdf = await import(`../lib/costflow/pdfExport.ts?http=${suffix}`);
    const security = await import(`../lib/costflow/settlementSecurity.ts?http=${suffix}`);
    for (const [family, sourceKind] of families) {
      await client.$transaction(tx => sealing.sealExportSourceProjection(tx, {
        projectId: project.id, family, sourceKind, sourceId: `${family.toLowerCase()}-${suffix}`, sourceVersion: 1,
        approvalAttemptId: `attempt-${family}-${suffix}`, approvedSnapshotId: null, signingState: "UNSIGNED",
        payload: { title: `${family} exact`, rows: [{ id: "line-1", description: `${family} line` }] },
        lines: [{ id: "line-1", rawNet: "100", rawVat: "8", rawGross: "108", vatPercent: "8" }],
      }));
    }

    server = createServer(async (request, response) => {
      try {
        const parsed = new URL(request.url ?? "/", ORIGIN);
        const match = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/costflow\/export\/([^/]+)(\/pdf)?$/);
        const sessionId = request.headers.cookie?.match(/session=([^;]+)/)?.[1];
        const user = sessionId ? await client.user.findUnique({ where: { id: sessionId } }) : null;
        if (!match || !user) { response.writeHead(401).end(); return; }
        const [, projectId, route, pdfSuffix] = match;
        const family = familyByPath.get(route);
        if (!family) { response.writeHead(404).end(); return; }
        if (user.role !== "ADMIN" && !(await client.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } }))) { response.writeHead(403).end(); return; }
        const sourceKind = parsed.searchParams.get("sourceKind") ?? "";
        const sourceId = parsed.searchParams.get("sourceId") ?? "";
        const sourceVersion = Number(parsed.searchParams.get("sourceVersion"));
        const resolved = await client.$transaction(tx => exporting.resolveSealedExportProjection(tx, { projectId, family, sourceKind, sourceId, sourceVersion }));
        const format = pdfSuffix ? "PDF" : "XLSX";
        const reservation = await client.$transaction(tx => security.reserveSettlementExportArtifact(tx, { sourceProjection: resolved.sourceProjection, format, createdById: user.id }));
        const output = pdfSuffix
          ? { bytes: pdf.renderCostFlowPdf({ projection: resolved.projection, sourceProjection: resolved.sourceProjection }), contentType: "application/pdf", fileName: `${route}.pdf` }
          : { ...(await exporting.buildSettlementExportWorkbook(resolved.projection)), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
        const finalized = await client.$transaction(tx => security.finalizeSettlementExportArtifact(tx, { auditId: reservation.audit.id, reservationToken: reservation.reservationToken, bytes: output.bytes }));
        response.writeHead(200, { "Content-Type": output.contentType, "Content-Disposition": `attachment; filename=${output.fileName}`, "X-Settlement-File-SHA256": finalized.fileSha256 });
        response.end(Buffer.from(finalized.artifactBytes));
      } catch (error) {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "failed" }));
      }
    });
    await listen(server);

    const forbiddenSource = await client.settlementExportSourceProjection.findFirstOrThrow({ where: { projectId: project.id, family: "QUOTATION" } });
    const forbiddenQuery = new URLSearchParams({ sourceKind: forbiddenSource.sourceKind, sourceId: forbiddenSource.sourceId, sourceVersion: String(forbiddenSource.sourceVersion) });
    const forbidden = await fetch(`${ORIGIN}/api/projects/${project.id}/costflow/export/quotation?${forbiddenQuery}`, { headers: { cookie: `session=${outsider.id}` } });
    assert.equal(forbidden.status, 403);

    for (const [family, , route] of families) {
      const source = await client.settlementExportSourceProjection.findFirstOrThrow({ where: { projectId: project.id, family } });
      const query = new URLSearchParams({ sourceKind: source.sourceKind, sourceId: source.sourceId, sourceVersion: String(source.sourceVersion) });
      const xlsx = await fetch(`${ORIGIN}/api/projects/${project.id}/costflow/export/${route}?${query}`, { headers: { cookie: `session=${actor.id}` } });
      assert.equal(xlsx.status, 200, `${family} XLSX`);
      assert.match(xlsx.headers.get("content-type") ?? "", /spreadsheetml/);
      assert.ok((await xlsx.arrayBuffer()).byteLength > 1000);

      const result = await fetch(`${ORIGIN}/api/projects/${project.id}/costflow/export/${route}/pdf?${query}`, { headers: { cookie: `session=${actor.id}` } });
      assert.equal(result.status, 200, `${family} PDF`);
      assert.equal(result.headers.get("content-type"), "application/pdf");
      assert.match(result.headers.get("content-disposition") ?? "", /attachment/i);
      const bytes = Buffer.from(await result.arrayBuffer());
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      assert.ok(bytes.length > 500);
      assert.match(bytes.toString("latin1"), new RegExp(`${family}.*version 1`, "s"));
      const audit = await client.settlementExportAudit.findFirstOrThrow({ where: { projectId: project.id, family, format: "PDF", sourceProjectionId: source.id } });
      assert.equal(audit.artifactStatus, "FINALIZED");
      assert.deepEqual(Buffer.from(audit.artifactBytes), bytes);
      assert.equal(audit.fileSha256, createHash("sha256").update(bytes).digest("hex"));
      const replay = await fetch(`${ORIGIN}/api/projects/${project.id}/costflow/export/${route}/pdf?${query}`, { headers: { cookie: `session=${actor.id}` } });
      assert.deepEqual(Buffer.from(await replay.arrayBuffer()), bytes);
    }
  } finally {
    if (server) await close(server);
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    const rows = await admin.$queryRawUnsafe(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${schemaName}'`);
    assert.equal(rows.length, 0, "disposable HTTP schema must be removed");
    await admin.$disconnect();
  }
});
