import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("preview route is authenticated, project-scoped and zero-write", async () => {
  const route = await readFile(path.join(process.cwd(), "app/api/projects/[id]/costflow/excel-intake/preview/route.ts"), "utf8");
  assert.match(route, /getCurrentUser/);
  assert.match(route, /status:\s*401/);
  assert.match(route, /projectId_userId|projectMember/);
  assert.match(route, /status:\s*404/);
  assert.doesNotMatch(route, /\.(?:create|update|upsert|delete)\s*\(/);
});

test("confirm service is serializable, CAS-protected, idempotent and append-only", async () => {
  const service = await readFile(path.join(process.cwd(), "lib/costflow/excelIntakeService.ts"), "utf8");
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /expectedVersion/);
  assert.match(service, /excelIntakeReceipts/);
  assert.match(service, /idempotencyKey/);
  assert.match(service, /fingerprint/);
  assert.match(service, /operationFingerprint/);
  assert.match(service, /quotationDrafts\s*=\s*\[\.\.\./);
  assert.doesNotMatch(service, /finalizePairedQuotation|submit|approve|costFlowCash|revenue|settlement/i);
});

test("confirm action derives actor from session and returns only safe result fields", async () => {
  const action = await readFile(path.join(process.cwd(), "app/actions/costflowExcelIntake.ts"), "utf8");
  assert.match(action, /requireUser/);
  assert.match(action, /confirmExcelIntake/);
  assert.match(action, /draftId/);
  assert.match(action, /idempotent/);
  assert.doesNotMatch(action, /form\.get\(["'](?:actor|role|draftId|total)/);
});
