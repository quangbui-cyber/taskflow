import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { getCrmSettings, saveCrmSetting, saveReason, saveProgramType, setTeamManagers, setCrmDataStewards, listSettingChanges } from "../lib/crm/settings";
import { loadProgramTypes, programTypeDisplay, isActiveProgramType } from "../lib/programTypes";
import { createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";
test("CRM settings compare-and-set records history and catalogs keep hidden rows", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = randomUUID();
  const original = await db.crmSetting.findUniqueOrThrow({ where: { key: "tier.cadenceWeeks" } });
  const stewards = await db.user.findMany({ where: { isCrmDataSteward: true }, select: { id: true } });
  const code = `TEST_${prefix.replaceAll("-", "").slice(0, 20).toUpperCase()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    const settings = await getCrmSettings(db);
    const saved = await saveCrmSetting(db, { key: "tier.cadenceWeeks", value: { ...settings.cadenceWeeks, C: 12 }, expectedVersion: settings.versions["tier.cadenceWeeks"], actor: f.admin });
    assert.ok("ok" in saved);
    const logs = await listSettingChanges(db, "tier.cadenceWeeks");
    assert.equal(logs[0].userName, f.admin.name);
    assert.deepEqual(logs[0].oldValue, original.value);
    assert.equal((logs[0].newValue as { C: number }).C, 12);
    const stale = await saveCrmSetting(db, { key: "tier.cadenceWeeks", value: settings.cadenceWeeks, expectedVersion: original.version, actor: f.admin });
    assert.ok("error" in stale && stale.error.includes("Tải lại"));
    assert.ok("error" in await saveCrmSetting(db, { key: "tier.cadenceWeeks", value: { ...settings.cadenceWeeks, C: 0 }, expectedVersion: original.version + 1, actor: f.admin }));
    const reason = await saveReason(db, { group: "LOST", label: prefix, requiresNote: true, active: true, order: 20 }, f.admin);
    assert.ok("id" in reason);
    if (!("id" in reason)) throw new Error("Missing reason");
    await saveReason(db, { id: reason.id, group: "LOST", label: prefix, requiresNote: true, active: false, order: 20 }, f.admin);
    assert.equal((await db.crmReason.findUniqueOrThrow({ where: { id: reason.id } })).active, false);
    assert.ok("code" in await saveProgramType(db, { code, label: "Roadshow test", color: "#123456", active: true, order: 30 }, f.admin));
    assert.equal((await db.programType.findUniqueOrThrow({ where: { code: "MICE" } })).code, "MICE");
    const types = await loadProgramTypes(db, { activeOnly: true });
    assert.equal(isActiveProgramType(types, code), true);
    assert.equal(programTypeDisplay(types, code).className, "bg-zinc-100 text-zinc-700");
    await setTeamManagers(db, f.team.id, [f.pic.id], f.admin);
    assert.deepEqual((await db.crmTeamManager.findMany({ where: { teamId: f.team.id } })).map((m) => m.userId), [f.pic.id]);
    assert.equal((await listSettingChanges(db, `teamManagers.${f.team.id}`)).length, 1);
    await setCrmDataStewards(db, [...stewards.map((u) => u.id), f.pic.id], f.admin);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.pic.id } })).isCrmDataSteward, true);
  } finally {
    await db.crmSetting.update({ where: { key: original.key }, data: { value: original.value as object, version: original.version, updatedById: original.updatedById } });
    await db.user.updateMany({ where: { isCrmDataSteward: true }, data: { isCrmDataSteward: false } });
    await db.user.updateMany({ where: { id: { in: stewards.map((u) => u.id) } }, data: { isCrmDataSteward: true } });
    await db.crmSettingChange.deleteMany({ where: { userName: `${prefix} admin` } });
    await db.crmReason.deleteMany({ where: { label: prefix } });
    await db.programType.deleteMany({ where: { code } });
    try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); }
  }
});
