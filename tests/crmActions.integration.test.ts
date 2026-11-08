import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { updateClientProfile, changeClientPicOrTeam, saveBuyingUnit, scorePotential, confirmImportedClient } from "../lib/crm/clientService";
import { createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";
import type { CrmActor } from "../lib/crm/policy";
import { loadClientRevenue24m, loadClientList, loadClientProfile, CLIENT_PAGE_SIZE } from "../lib/crm/clientData";
import { getCrmSettings } from "../lib/crm/settings";

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

test("Client loaders aggregate recognized revenue, task owners, touchpoints and profile data", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb();
  const prefix = randomUUID();
  const now = new Date("2026-11-10T03:00:00Z");
  try {
    const f = await seedCrmFixture(db, prefix);
    const noNext = await db.client.create({ data: { name: `${prefix} A no next`, picAccountId: f.picAccount.id, importStatus: "PENDING_PIC_CONFIRM" } });
    const overdue = await db.client.create({ data: { name: `${prefix} Z overdue`, responsibleTeamId: f.team.id } });
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, potentialLevel: "HIGH", potentialScoredById: f.manager.id } });
    const project = { name: `${prefix} Revenue`, category: "CLIENT" as const, ownerId: f.pic.id, clientId: f.client.id, accountId: f.picAccount.id, status: "DONE", type: "MICE", revenue: 100, onProcessAt: new Date("2026-09-01T03:00:00Z"), executionStartAt: new Date("2026-09-10T03:00:00Z") };
    await db.project.create({ data: project });
    await db.project.create({ data: { ...project, name: `${prefix} Old`, revenue: 900, onProcessAt: new Date("2023-01-01T00:00:00Z") } });
    await db.project.create({ data: { ...project, name: `${prefix} Pending`, revenue: 800, status: "PENDING" } });
    await db.project.create({ data: { ...project, name: `${prefix} Boundary excluded`, revenue: 700, onProcessAt: now } });
    const next = await db.task.create({ data: { title: "Opportunity next step", creatorId: f.pic.id, assigneeId: f.assignee.id, opportunityId: f.opportunity.id, dueDate: new Date("2026-11-11T03:00:00Z") } });
    await db.task.create({ data: { title: "Later direct task", creatorId: f.pic.id, clientId: f.client.id, dueDate: new Date("2026-11-12T03:00:00Z") } });
    await db.task.create({ data: { title: "Cancelled earlier task", creatorId: f.pic.id, clientId: f.client.id, status: "CANCELLED", dueDate: new Date("2026-11-01T03:00:00Z") } });
    await db.task.create({ data: { title: "Overdue task", creatorId: f.pic.id, clientId: overdue.id, dueDate: new Date("2026-11-09T03:00:00Z") } });
    const confirmed = await db.touchpoint.create({ data: { clientId: f.client.id, kind: "CALL", occurredAt: new Date("2026-11-08T03:00:00Z"), status: "CONFIRMED", outcomeLevel: 2 } });
    await db.touchpoint.create({ data: { clientId: f.client.id, kind: "MEETING", occurredAt: now, status: "DRAFT", outcomeLevel: 4 } });
    const settings = await getCrmSettings(db);
    settings.potentialScale = [{ key: "HIGH", label: "Cao" }];
    settings.tierMatrix = { revenueBands: [{ key: "all", label: "All", minPercentile: 0 }], cells: { all: { HIGH: "A" } } };
    assert.equal(CLIENT_PAGE_SIZE, 50);
    assert.equal((await loadClientRevenue24m(db, now)).get(f.client.id), 100);
    assert.equal((await loadClientRevenue24m(db, now, [noNext.id])).has(f.client.id), false);
    const list = await loadClientList(db, { q: prefix }, settings, now);
    assert.deepEqual(list.rows.map((client) => client.id), [noNext.id, overdue.id, f.client.id]);
    const client = list.rows.find((row) => row.id === f.client.id)!;
    assert.equal(client.tier, "A");
    assert.equal(client.revenue24m, 100);
    assert.equal(client.nextStep?.id, next.id);
    assert.equal(client.lastTouchpoint?.id, confirmed.id);
    assert.equal(client.openOpportunityCount, 1);
    const tierFiltered = await loadClientList(db, { q: prefix, tier: "A" }, settings, now);
    assert.equal(tierFiltered.inCareCount, 1, "Care subtitle follows the filtered result set");
    assert.equal(client.team?.id, f.team.id, "Team falls back to PIC's team");
    assert.deepEqual((await loadClientList(db, { q: prefix, status: "OVERDUE" }, settings, now)).rows.map((row) => row.id), [overdue.id]);
    assert.deepEqual((await loadClientList(db, { q: prefix, status: "NO_NEXT_STEP" }, settings, now)).rows.map((row) => row.id), [noNext.id]);
    assert.deepEqual((await loadClientList(db, { q: prefix, status: "PENDING_PIC_CONFIRM", teamId: f.team.id }, settings, now)).rows.map((row) => row.id), [noNext.id]);
    const page = await loadClientList(db, { q: prefix, take: 1, skip: 1 }, settings, now);
    assert.equal(page.rows[0].id, overdue.id);
    assert.equal(page.total, 3);
    assert.equal(page.hasMore, true);
    const profile = await loadClientProfile(db, f.client.id, settings, now);
    assert.ok(profile);
    assert.equal(profile.tier, "A");
    assert.equal(profile.cadenceWeeks, 4);
    assert.equal(profile.potentialScoredBy?.id, f.manager.id);
    assert.equal(profile.opportunities[0].nextStep?.id, next.id);
    assert.equal(profile.touchpoints[0].draft, true);
    assert.equal(profile.persona.enoughData, true);
    assert.equal(profile.persona.programHistory[0].code, "MICE");
    assert.equal(profile.tasks.length, 2);
    assert.equal(await loadClientProfile(db, "missing-client", settings, now), null);
  } finally {
    try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); }
  }
});
