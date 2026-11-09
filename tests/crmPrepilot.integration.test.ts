import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePrepilot, loadPrepilotInput } from "../lib/crm/prepilot";
import { crmTestDatabaseUrl, createCrmTestDb } from "./helpers/crmTestDb";

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
