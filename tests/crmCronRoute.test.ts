import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

class InitializationError extends Error {}
class RequestError extends Error { constructor(public code: string) { super("private SQL details"); } }
function harness() {
  const env: Record<string, string> = { CRON_SECRET: "test-only-secret" };
  const state = { enabled: true, jobs: 0, inserts: 0, failJobs: 0, error: null as Error | null, failPush: false, push: 0, deferred: [] as (() => Promise<void>)[], logs: [] as unknown[][] };
  const rows = [{ userId: "private-user", type: "CRM_DUE", message: "Private client message", taskId: "task", clientId: "client", opportunityId: null, dedupeKey: "crm:task:date:private-user" }];
  const inserted = new Set<string>();
  const modules: Record<string, unknown> = {
    "@prisma/client": { Prisma: { PrismaClientInitializationError: InitializationError, PrismaClientKnownRequestError: RequestError } },
    "next/server": { after: (fn: () => Promise<void>) => state.deferred.push(fn) },
    "@/lib/features": { crmEnabled: () => state.enabled },
    "@/lib/prisma": { prisma: { notification: { createManyAndReturn: async ({ data, skipDuplicates }: { data: typeof rows; skipDuplicates: boolean }) => {
      state.inserts++; assert.equal(skipDuplicates, true);
      return data.filter(row => { if (inserted.has(row.dedupeKey)) return false; inserted.add(row.dedupeKey); return true; });
    } } } },
    "@/lib/crm/reminderJob": { runCrmReminderJob: async () => {
      state.jobs++; if (state.error && state.jobs <= state.failJobs) throw state.error;
      return { openedSteps: 1, mergedSteps: 2, cadenceTasks: 3, planCloseTasks: 4, passedEvents: 5, meetingDrafts: 6, partial: true, skipped: [{ reason: "NO_CREATOR", id: "private-id" }], notifications: rows };
    } },
    "@/lib/crm/access": { listCrmAllowedUserIds: async () => ["private-user"] },
    "@/lib/webPush": { deliverPush: async () => { state.push++; if (state.failPush) throw new Error("private provider payload"); } },
  };
  const compiled = ts.transpileModule(readFileSync(resolve("app/api/cron/crm-reminders/route.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  runInNewContext(compiled, {
    module: mod, exports: mod.exports, require: (name: string) => { if (!(name in modules)) throw new Error(`Unexpected import ${name}`); return modules[name]; },
    process: { env }, Response, Date, Error, setTimeout: (fn: () => void) => fn(),
    console: { warn: (...args: unknown[]) => state.logs.push(args), error: (...args: unknown[]) => state.logs.push(args) },
  });
  const route = mod.exports as { GET: (req: Request) => Promise<Response>; runtime: string; dynamic: string; maxDuration: number };
  const call = (auth: string | null = "Bearer test-only-secret") => route.GET(new Request("http://localhost/api/cron/crm-reminders", { headers: auth ? { authorization: auth } : {} }));
  return { state, env, route, call };
}
test("cron requires configured exact Bearer secret before disabled flag or database work", async () => {
  const h = harness(); h.state.enabled = false;
  for (const auth of [null, "test-only-secret", "Bearer wrong"]) assert.equal((await h.call(auth)).status, 401);
  delete h.env.CRON_SECRET; assert.equal((await h.call()).status, 401);
  assert.equal(h.state.jobs, 0); assert.equal(h.state.inserts, 0); assert.equal(h.state.logs.length, 0);
});
test("CRM disabled acknowledges skip with no job, persistence or push", async () => {
  const h = harness(); h.state.enabled = false;
  assert.deepEqual(await (await h.call()).json(), { ok: true, skipped: "CRM_DISABLED" });
  assert.equal(h.state.jobs, 0); assert.equal(h.state.inserts, 0); assert.equal(h.state.deferred.length, 0);
});
test("only newly inserted notices push after response; repeat is deduped and response contains counts", async () => {
  const h = harness();
  assert.equal(h.route.runtime, "nodejs"); assert.equal(h.route.dynamic, "force-dynamic"); assert.equal(h.route.maxDuration, 60);
  const body = await (await h.call()).json();
  assert.deepEqual(body, { ok: true, openedSteps: 1, mergedSteps: 2, cadenceTasks: 3, planCloseTasks: 4, passedEvents: 5, meetingDrafts: 6, notifications: 1, skipped: 1, partial: true });
  assert.equal(h.state.push, 0); assert.equal(h.state.deferred.length, 1);
  assert.equal((await (await h.call()).json()).notifications, 0); assert.equal(h.state.deferred.length, 1);
  h.state.failPush = true; await h.state.deferred[0](); assert.equal(h.state.push, 1);
  const logged = JSON.stringify(h.state.logs); assert.ok(!/private|message|secret|client/.test(logged)); assert.match(logged, /failed/);
});
test("unexpected error returns safe 503 and logs error name only", async () => {
  const h = harness(); h.state.error = new Error("private SQL/client/secret"); h.state.failJobs = 1;
  const response = await h.call(); assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "CRM reminders failed" });
  assert.deepEqual(h.state.logs, [["CRM reminders cron failed", "Error"]]); assert.equal(h.state.deferred.length, 0);
});
test("transient database failures retry, but non-transient errors do not", async () => {
  const h = harness(); h.state.error = new RequestError("P1001"); h.state.failJobs = 2;
  assert.equal((await h.call()).status, 200); assert.equal(h.state.jobs, 3);
  const bad = harness(); bad.state.error = new RequestError("P2003"); bad.state.failJobs = 4;
  assert.equal((await bad.call()).status, 503); assert.equal(bad.state.jobs, 1);
});
