import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { updateClientProfile, changeClientPicOrTeam, saveBuyingUnit, scorePotential, confirmImportedClient } from "../lib/crm/clientService";
import { createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";
import type { CrmActor } from "../lib/crm/policy";

test("Client mutations enforce PIC/manager permissions, versions and client boundaries", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const prefix = randomUUID();
  const original = await db.crmSetting.findUniqueOrThrow({ where: { key: "tier.potentialScale" } });
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id, importStatus: "PENDING_PIC_CONFIRM" } });
    await db.crmSetting.update({ where: { key: original.key }, data: { value: [{ key: "HIGH", label: "Cao" }] } });
    const actor = (user: typeof f.pic, manager = false): CrmActor & { name: string } => ({ id: user.id, name: user.name, role: user.role, accountId: user.id === f.pic.id ? f.picAccount.id : user.id === f.manager.id ? f.otherAccount.id : null, managedTeamIds: manager ? [f.team.id] : [], isDataSteward: false });
    const pic = actor(f.pic), manager = actor(f.manager, true), outsider = actor(f.outsider);
    const clientId = f.client.id;

    await t.test("outsider profile edit is denied without changing the client", async () => {
      const result = await updateClientProfile(db, outsider, { clientId, expectedVersion: 0, industry: "Banking" });
      assert.ok("error" in result && result.error.includes("quyền"));
      const row = await db.client.findUniqueOrThrow({ where: { id: clientId } });
      assert.equal(row.industry, null);
      assert.equal(row.version, 0);
    });

    await t.test("PIC cannot reassign; manager reassigns with notification only after commit", async () => {
      const input = { clientId, expectedVersion: 0, picAccountId: f.otherAccount.id, responsibleTeamId: f.team.id };
      assert.ok("error" in await changeClientPicOrTeam(db, pic, input, { notify: async () => assert.fail("Denied mutation notified") }));
      const messages: string[] = [];
      const effects = { notify: async (ids: string[], data: { type: string; message: string; clientId: string }) => {
        assert.equal((await db.client.findUniqueOrThrow({ where: { id: clientId } })).picAccountId, f.otherAccount.id);
        assert.deepEqual(ids, [f.manager.id]);
        assert.equal(data.type, "CRM_PIC_ASSIGNED");
        assert.equal(data.clientId, clientId);
        messages.push(data.message);
      } };
      assert.deepEqual(await changeClientPicOrTeam(db, manager, input, effects), { ok: true, version: 1 });
      assert.deepEqual(messages, [`Bạn được giao phụ trách ${f.client.name}.`]);
      assert.deepEqual(await changeClientPicOrTeam(db, manager, { ...input, expectedVersion: 1, picAccountId: f.picAccount.id }, { notify: async () => {} }), { ok: true, version: 2 });
    });

    await t.test("stale profile version is rejected", async () => {
      const result = await updateClientProfile(db, pic, { clientId, expectedVersion: 0, industry: "Banking" });
      assert.ok("error" in result && result.error.includes("Tải lại"));
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: clientId } })).industry, null);
    });

    await t.test("manager scores configured potential with attribution; PIC and unknown level are rejected", async () => {
      assert.ok("error" in await scorePotential(db, pic, { clientId, level: "HIGH" }));
      assert.ok("error" in await scorePotential(db, manager, { clientId, level: "UNKNOWN" }));
      assert.ok("ok" in await scorePotential(db, manager, { clientId, level: "HIGH", note: "  Review  " }));
      const row = await db.client.findUniqueOrThrow({ where: { id: clientId } });
      assert.equal(row.potentialLevel, "HIGH");
      assert.equal(row.potentialScoredById, f.manager.id);
      assert.ok(row.potentialScoredAt);
      const history = await db.clientPotentialScore.findMany({ where: { clientId } });
      assert.equal(history.length, 1);
      assert.equal(history[0].scoredByName, f.manager.name);
      assert.equal(history[0].note, "Review");
    });

    await t.test("only current PIC confirms imported client and repeat confirmation is harmless", async () => {
      assert.ok("error" in await confirmImportedClient(db, manager, { clientId }));
      assert.ok("ok" in await confirmImportedClient(db, pic, { clientId }));
      const confirmed = await db.client.findUniqueOrThrow({ where: { id: clientId } });
      assert.equal(confirmed.importStatus, "CONFIRMED");
      assert.ok(confirmed.importConfirmedAt);
      assert.ok("ok" in await confirmImportedClient(db, pic, { clientId }));
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: clientId } })).version, confirmed.version);
    });

    await t.test("buying units remain inside client, support rename/hide and reject duplicates", async () => {
      const created = await saveBuyingUnit(db, pic, { clientId, name: "  Head office  ", active: true });
      assert.ok("ok" in created && created.id);
      if (!("ok" in created) || !created.id) throw new Error("Missing buying unit");
      const duplicate = await saveBuyingUnit(db, pic, { clientId, name: "Head office", active: true });
      assert.ok("error" in duplicate && duplicate.error === "Đơn vị mua đã có trong khách này.");
      assert.ok("ok" in await saveBuyingUnit(db, pic, { clientId, id: created.id, name: "Regional office", active: false }));
      assert.equal((await db.buyingUnit.findUniqueOrThrow({ where: { id: created.id } })).active, false);
      const other = await db.client.create({ data: { name: `${prefix} Another Client` } });
      const foreign = await db.buyingUnit.create({ data: { clientId: other.id, name: "Foreign unit" } });
      assert.ok("error" in await saveBuyingUnit(db, pic, { clientId, id: foreign.id, name: "Hijacked", active: false }));
      assert.equal((await db.buyingUnit.findUniqueOrThrow({ where: { id: foreign.id } })).name, "Foreign unit");
    });

    await t.test("optional profile fields validate month and normalize text", async () => {
      const row = await db.client.findUniqueOrThrow({ where: { id: clientId } });
      assert.ok("error" in await updateClientProfile(db, pic, { clientId, expectedVersion: row.version, budgetSeasonMonth: 13 }));
      assert.ok("ok" in await updateClientProfile(db, pic, { clientId, expectedVersion: row.version, industry: "  Banking  ", budgetSeasonMonth: 11, valuedMost: " " }));
      const saved = await db.client.findUniqueOrThrow({ where: { id: clientId } });
      assert.equal(saved.industry, "Banking");
      assert.equal(saved.budgetSeasonMonth, 11);
      assert.equal(saved.valuedMost, null);
    });

    await t.test("concurrent edits with one version produce exactly one winner", async () => {
      const row = await db.client.findUniqueOrThrow({ where: { id: clientId } });
      const results = await Promise.all(["First", "Second"].map((industry) => updateClientProfile(db, pic, { clientId, expectedVersion: row.version, industry })));
      assert.equal(results.filter((r) => "ok" in r).length, 1);
      assert.equal(results.filter((r) => "error" in r && r.error.includes("Tải lại")).length, 1);
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: clientId } })).version, row.version + 1);
    });
  } finally {
    await db.crmSetting.update({ where: { key: original.key }, data: { value: original.value as object, version: original.version, updatedById: original.updatedById } });
    try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); }
  }
});
