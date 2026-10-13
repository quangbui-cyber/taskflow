import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { parsePurchaseOrder } from "../lib/purchaseOrder.ts";
import { withPhase12TestSchema } from "./phase12/pilotFixture.ts";

const root = path.resolve(import.meta.dirname, "..");

function runLegacyPillars() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    "--conditions=react-server",
    "--import=tsx",
    "--test",
    "--test-concurrency=1",
    "tests/session-secret-build.test.ts",
    "tests/projectPolicy.test.ts",
    "tests/projectResponsibility.test.ts",
    "tests/taskCreationFiles.test.ts",
    "tests/commentMentions.test.ts",
    "tests/documents.test.ts",
    "tests/kpi.test.ts",
    "tests/pushPolicy.test.ts",
    "tests/pushWorker.test.ts",
  ], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, output);
  return output;
}

test("Phase 12 executes auth, project, task, file, revenue and notification behavior pillars", () => {
  const output = runLegacyPillars();
  assert.match(output, /session module defers SESSION_SECRET validation until the runtime auth boundary/);
  assert.match(output, /USER can create projects without acquiring financial access/);
  assert.match(output, /PO imports require financial access and a customer project/);
  assert.match(output, /brief and result files keep their kind, content and sanitized name/);
  assert.match(output, /same display names retain different selected user identities/);
  assert.match(output, /only admins manage shared documents/);
  assert.match(output, /splitting a yearly target keeps the exact total/);
  assert.match(output, /submitted endpoints cannot proxy private networks/);
  assert.match(output, /background pushes show the message and clicking opens the correct task/);
  assert.match(output, /fail 0/);
});

test("representative Jabil PO parsing preserves the original input and Project.revenue draft semantics", () => {
  const original = [
    "Jabil Circuit Vietnam PURCHASE ORDER",
    "C-10003769550 14/09/2026",
    "STD 30 Days NET",
    "VND",
    "Line Description Need By Qty Unit Price Total",
    "1 POSM booth",
    "30/09/2026 2 Units 5,000,000 10,000,000",
    "Asset Tags: none",
    "Chart of Account: 6000",
    "**INVOICING",
    "2 Units 10,000,000 VND",
  ].join("\n");
  const bytesBefore = Buffer.from(original);
  const draft = parsePurchaseOrder(original);
  assert.equal(draft.provider, "JABIL");
  assert.equal(draft.poNumber, "C-10003769550");
  assert.equal(draft.revenue, 10000000);
  assert.equal(draft.currency, "VND");
  assert.equal(draft.items.length, 1);
  assert.deepEqual(Buffer.from(original), bytesBefore, "PO parser does not mutate original evidence input");
});

test("unauthorized daily-digest retries stay read-only and do not mutate workflow or task state", async () => {
  await withPhase12TestSchema(async ({ client, schemaName }) => {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "phase12-cron-secret";
    try {
      const before = {
        requests: await client.workflowRequest.count(),
        tasks: await client.task.count(),
        notifications: await client.notification.count(),
      };
      const { GET } = await import(`../app/api/cron/daily-digest/route.ts?phase12=${schemaName}`);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await GET(new Request("http://localhost:3017/api/cron/daily-digest", {
          headers: { authorization: "Bearer invalid" },
        }));
        assert.equal(response.status, 401);
        assert.equal(await response.text(), "Unauthorized");
      }
      assert.deepEqual({
        requests: await client.workflowRequest.count(),
        tasks: await client.task.count(),
        notifications: await client.notification.count(),
      }, before);
    } finally {
      process.env.CRON_SECRET = previousSecret;
    }
  });
});
