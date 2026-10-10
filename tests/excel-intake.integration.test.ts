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
