import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { test } from "node:test";
import { getCrmSettings, saveCrmSetting } from "../lib/crm/settings";
import { emptyPersonaDepth, type PersonaDepth } from "../lib/crm/personaDepth";
import { evaluatePrepilot, loadPrepilotInput } from "../lib/crm/prepilot";
import { loadClientProfile } from "../lib/crm/clientData";
import { updateClientProfile } from "../lib/crm/clientService";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("persona depth settings preserve legacy profiles, enforce CAS and follow the current tier", { skip: !crmTestDatabaseUrl() }, async t => {
  const db = createCrmTestDb();
  const prefix = randomUUID();
  const keys = ["persona.depth", "tier.potentialScale", "tier.matrix"];
  const before = await db.crmSetting.findMany({ where: { key: { in: keys } }, orderBy: { key: "asc" } });
  const actorName = `${prefix} admin`;
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    await db.crmSetting.deleteMany({ where: { key: "persona.depth" } });
    const save = (value: unknown, expectedVersion: number) => saveCrmSetting(db, { key: "persona.depth", value, expectedVersion, actor: f.admin });
    const policyRow = () => db.crmSetting.findUniqueOrThrow({ where: { key: "persona.depth" } });
    const now = new Date("2026-11-09T10:00:00Z");
    const profile = async () => (await loadClientProfile(db, f.client.id, await getCrmSettings(db), now))!;

    await t.test("missing and malformed stored policy stays unconfigured without writing on read", async () => {
      const settings = await getCrmSettings(db);
      assert.deepEqual(settings.personaDepth, emptyPersonaDepth());
      assert.equal(settings.versions["persona.depth"], 0);
      assert.equal((await profile()).personaDepth.status, "NOT_CONFIGURED");
      assert.equal(await db.crmSetting.count({ where: { key: "persona.depth" } }), 0);
      await db.crmSetting.create({ data: { key: "persona.depth", value: { S: ["unknown"] } } });
      assert.deepEqual((await getCrmSettings(db)).personaDepth, emptyPersonaDepth());
      assert.ok(evaluatePrepilot(await loadPrepilotInput(db, now)).missing.includes("PERSONA_DEPTH"));
      await db.crmSetting.delete({ where: { key: "persona.depth" } });
    });

    await t.test("invalid first save does not create configuration or history", async () => {
      assert.ok("error" in await save({ ...emptyPersonaDepth(), S: ["industry"] }, 0));
      assert.equal(await db.crmSetting.count({ where: { key: "persona.depth" } }), 0);
      assert.equal(await db.crmSettingChange.count({ where: { userId: f.admin.id, key: "persona.depth" } }), 0);
    });

    await t.test("simultaneous first saves have one winner and one audit entry", async () => {
      const results = await Promise.all([save({ ...emptyPersonaDepth(), S: ["budgetSeason"] }, 0), save({ ...emptyPersonaDepth(), A: ["vendorSelection"] }, 0)]);
      assert.equal(results.filter(result => "ok" in result).length, 1);
      assert.equal(results.filter(result => "error" in result).length, 1);
      const row = await policyRow();
      assert.equal(row.version, 1);
      assert.equal(row.updatedById, f.admin.id);
      const logs = await db.crmSettingChange.findMany({ where: { userId: f.admin.id, key: "persona.depth" } });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].oldValue, null);
      assert.deepEqual(logs[0].newValue, row.value);
    });

    const configured: PersonaDepth = { S: ["budgetSeason", "budgetSeasonMonth"], A: ["vendorSelection"], B: ["valuedMost"], C: [], UNRATED: ["budgetSeason"] };
    await t.test("subsequent save logs old/new values, rejects stale and permits returning to pending", async () => {
      const old = await policyRow();
      assert.deepEqual(await save(configured, 1), { ok: true, version: 2 });
      const current = await policyRow();
      const changes = await db.crmSettingChange.findMany({ where: { userId: f.admin.id, key: "persona.depth" }, orderBy: { createdAt: "desc" } });
      assert.deepEqual(changes[0].oldValue, old.value);
      assert.deepEqual(changes[0].newValue, configured);
      assert.ok("error" in await save(emptyPersonaDepth(), 1));
      assert.deepEqual(await policyRow(), current);
      assert.equal(await db.crmSettingChange.count({ where: { userId: f.admin.id, key: "persona.depth" } }), 2);
      assert.deepEqual(await save({ ...configured, C: null }, 2), { ok: true, version: 3 });
      assert.ok(evaluatePrepilot(await loadPrepilotInput(db, now)).missing.includes("PERSONA_DEPTH"));
      assert.deepEqual(await save(configured, 3), { ok: true, version: 4 });
      assert.ok(!evaluatePrepilot(await loadPrepilotInput(db, now)).missing.includes("PERSONA_DEPTH"));
    });

    const scale = ["S", "A", "B", "C"].map(key => ({ key, label: key }));
    await db.crmSetting.update({ where: { key: "tier.potentialScale" }, data: { value: scale } });
    await db.crmSetting.update({ where: { key: "tier.matrix" }, data: { value: { revenueBands: [{ key: "base", label: "Test", minPercentile: 0 }], cells: { base: { S: "S", A: "A", B: "B", C: "C" } } } } });
    await db.client.update({ where: { id: f.client.id }, data: { potentialLevel: "S" } });
    const pic = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };

    await t.test("profile uses persisted tier, permission checks and partial saves with unchanged computed persona", async () => {
      const initial = await profile();
      assert.equal(initial.tier, "S");
      assert.deepEqual(initial.personaDepth.missing, ["budgetSeason", "budgetSeasonMonth"]);
      const outsider = { ...pic, id: f.outsider.id, role: f.outsider.role, accountId: null };
      assert.ok("error" in await updateClientProfile(db, outsider, { clientId: f.client.id, expectedVersion: initial.version, budgetSeason: "Changed" }));
      assert.ok("ok" in await updateClientProfile(db, pic, { clientId: f.client.id, expectedVersion: initial.version, budgetSeason: "Quý 4" }));
      const partial = await profile();
      assert.equal(partial.personaDepth.status, "INCOMPLETE");
      assert.deepEqual(partial.personaDepth.missing, ["budgetSeasonMonth"]);
      assert.ok("error" in await updateClientProfile(db, pic, { clientId: f.client.id, expectedVersion: initial.version, budgetSeasonMonth: 10 }));
      assert.ok("ok" in await updateClientProfile(db, pic, { clientId: f.client.id, expectedVersion: partial.version, budgetSeasonMonth: 10 }));
      assert.equal((await profile()).personaDepth.status, "COMPLETE");
      assert.deepEqual((await profile()).persona, initial.persona);
    });

    await t.test("changing tier selects its own expectations and preserves already entered fields", async () => {
      for (const [potentialLevel, tier, missing, status] of [
        ["A", "A", ["vendorSelection"], "INCOMPLETE"],
        ["B", "B", ["valuedMost"], "INCOMPLETE"],
        ["C", "C", [], "NO_REQUIREMENTS"],
        [null, "UNRATED", [], "COMPLETE"],
      ] as const) {
        await db.client.update({ where: { id: f.client.id }, data: { potentialLevel } });
        const row = await profile();
        assert.equal(row.tier, tier);
        assert.deepEqual(row.personaDepth.missing, missing);
        assert.equal(row.personaDepth.status, status);
        assert.equal(row.budgetSeason, "Quý 4");
        assert.equal(row.budgetSeasonMonth, 10);
      }
    });
  } finally {
    try {
      await db.$transaction(async tx => {
        for (const key of keys) {
          const original = before.find(row => row.key === key);
          if (original) {
            const { key: savedKey, ...data } = original;
            await tx.crmSetting.upsert({ where: { key }, create: { ...data, key: savedKey, value: data.value as Prisma.InputJsonValue }, update: { ...data, value: data.value as Prisma.InputJsonValue } });
          } else await tx.crmSetting.deleteMany({ where: { key } });
        }
        await tx.crmSettingChange.deleteMany({ where: { userName: actorName } });
      });
      assert.deepEqual(await db.crmSetting.findMany({ where: { key: { in: keys } }, orderBy: { key: "asc" } }), before);
      await cleanupCrmFixture(db, prefix);
    } finally { await db.$disconnect(); }
  }
});
