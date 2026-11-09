import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { evaluatePrepilot, loadPrepilotInput } from "../lib/crm/prepilot";
import { assertCrmTestDb, crmTestDatabaseUrl, createCrmTestDb } from "./helpers/crmTestDb";

async function snapshot(db: ReturnType<typeof createCrmTestDb>) {
  return Promise.all([
    db.crmSetting.findMany({ orderBy: { key: "asc" } }),
    db.crmSettingChange.count(),
    db.crmTeamManager.count(),
    db.crmReason.count(),
    db.user.count({ where: { isCrmDataSteward: true } }),
  ]);
}

test("prepilot loader reads stored configuration and leaves every monitored dataset unchanged", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb();
  try {
    const before = await snapshot(db);
    const raw = new Map(before[0].map(({ key, value }) => [key, value]));
    const input = await loadPrepilotInput(db, new Date("2026-11-08T17:30:00Z"));
    assert.equal(input.today, "2026-11-09");
    assert.deepEqual(input.cadenceWeeksRaw, raw.get("tier.cadenceWeeks") ?? null);
    assert.deepEqual(input.potentialScaleRaw, raw.get("tier.potentialScale") ?? null);
    assert.deepEqual(input.tierMatrixRaw, raw.get("tier.matrix") ?? null);
    assert.deepEqual(input.pipelineModeRaw, raw.get("pipeline.mode") ?? null);
    assert.equal(evaluatePrepilot(input).items.length, 10);
    assert.deepEqual(await snapshot(db), before);
  } finally {
    await db.$disconnect();
  }
});

test("prepilot CLI reports the same statuses, exit code and host without exposing credentials or writing", { skip: !crmTestDatabaseUrl() }, async () => {
  const url = crmTestDatabaseUrl()!;
  assertCrmTestDb(url);
  const target = new URL(url);
  assert.equal(target.pathname, "/taskflow_crm_test");
  const db = createCrmTestDb();
  const invoke = (args: string[], databaseUrl: string = url) => spawnSync(process.execPath,
    ["--import", "tsx", "scripts/crm/prepilot-check.ts", ...args],
    { encoding: "utf8", timeout: 20_000, env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, TZ: "Asia/Ho_Chi_Minh" } },
  );
  try {
    const before = await snapshot(db);
    const json = invoke(["--json"]);
    assert.ok(json.status === 0 || json.status === 1, "CLI must report readiness");
    assert.equal(json.stderr, "");
    assert.ok(!json.stdout.includes(url));
    for (const password of [target.password, decodeURIComponent(target.password)].filter(Boolean)) {
      assert.ok(!json.stdout.includes(password), "JSON output must not include credentials");
    }
    const report = JSON.parse(json.stdout);
    const evaluated = evaluatePrepilot(await loadPrepilotInput(db, new Date(report.checkedAt)));
    assert.equal(report.database, target.hostname);
    assert.equal(report.ready, evaluated.ready);
    assert.equal(json.status, evaluated.ready ? 0 : 1);
    assert.equal(report.items.length, 10);
    assert.deepEqual(report.items, evaluated.items);

    const text = invoke([]);
    assert.ok(text.status === 0 || text.status === 1);
    assert.ok(text.stdout.includes(`Database: ${target.hostname}`));
    assert.match(text.stdout, /Đã cấu hình|Chưa cấu hình/);
    assert.ok(!text.stdout.includes(url));

    const malformed = invoke(["--json"], "invalid-SYNTHETIC-secret");
    assert.equal(malformed.status, 2);
    assert.ok(!malformed.stderr.includes("SYNTHETIC-secret"));
    assert.equal(invoke(["--apply"]).status, 2);
    assert.deepEqual(await snapshot(db), before);
  } finally {
    await db.$disconnect();
  }
});
