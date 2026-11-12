import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { addClientAlias, archiveClient, removeClientAlias, removeClientCompetitor, restoreClient, saveClientCompetitor, setClientTags, setOpportunityCompetitors, updateClientIdentity, updateClientProfile, changeClientPicOrTeam, scorePotential } from "../lib/crm/clientService";
import { saveClientTag, saveCompetitor, saveCrmSetting } from "../lib/crm/settings";
import { loadWeeklyReviewGroups } from "../lib/crm/reviewData";
import { runCrmReminderJob } from "../lib/crm/reminderJob";
import { closeOpportunity, openOpportunity, CLIENT_ARCHIVED } from "../lib/crm/opportunityWorkflow";
import { loadClientList, loadClientProfile } from "../lib/crm/clientData";
import { getCrmSettings } from "../lib/crm/settings";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

const STALE = /Dữ liệu vừa được người khác cập nhật/;
const DENIED = /không có quyền/;
const taxCode = () => String(randomInt(1_000_000_000, 9_999_999_999));

test("crm50 client profile: identity, uniqueness, parent cycle, archive, catalogs, history and permissions", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const prefix = `profile-${randomUUID()}`;
  const settingKeys = ["client.industries", "client.sources"];
  const settingsBefore = await db.crmSetting.findMany({ where: { key: { in: settingKeys } } });
  const tagIds: string[] = []; const competitorIds: string[] = [];
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const actor = (user: { id: string; name: string }, role: string, accountId: string | null, managedTeamIds: string[]) => ({ id: user.id, name: user.name, role, accountId, managedTeamIds, isDataSteward: false });
    const admin = actor(f.admin, "ADMIN", null, []);
    const manager = actor(f.manager, "ACCOUNT", f.otherAccount.id, [f.team.id]);
    const pic = actor(f.pic, "ACCOUNT", f.picAccount.id, []);
    const user = actor(f.outsider, "USER", null, []);
    const make = (suffix: string) => db.client.create({ data: { name: `${prefix} ${suffix}`, picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const version = async (id: string) => (await db.client.findUniqueOrThrow({ where: { id } })).version;
    const changes = (clientId: string, field?: string) => db.clientFieldChange.findMany({ where: { clientId, ...(field ? { field } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

    await t.test("legacy profile still saves partially and every new field is optional", async () => {
      const before = await db.client.findUniqueOrThrow({ where: { id: f.client.id } });
      assert.equal(before.taxCode, null); assert.equal(before.parentClientId, null); assert.equal(before.archivedAt, null);
      const saved = await updateClientProfile(db, pic, { clientId: f.client.id, expectedVersion: before.version, budgetSeason: "Quý 3" });
      assert.ok("ok" in saved);
      const log = await changes(f.client.id, "budgetSeason");
      assert.equal(log.length, 1); assert.equal(log[0].oldValue, null); assert.equal(log[0].newValue, "Quý 3"); assert.equal(log[0].actorId, f.pic.id); assert.equal(log[0].actorName, f.pic.name);
      const profile = (await loadClientProfile(db, f.client.id, await getCrmSettings(db), new Date()))!;
      assert.equal(profile.lifecycle, "PROSPECT"); assert.deepEqual(profile.aliases, []); assert.deepEqual(profile.tags, []);
    });

    await t.test("identity saves normalized values and history in the same transaction", async () => {
      const code = taxCode();
      const spaced = `${code.slice(0, 4)} ${code.slice(4)} `;
      const v = await version(f.client.id);
      const result = await updateClientIdentity(db, pic, { clientId: f.client.id, expectedVersion: v, taxCode: spaced, legalName: "  Công ty TNHH Mẫu  ", website: "Example.vn" });
      assert.ok("ok" in result);
      const row = await db.client.findUniqueOrThrow({ where: { id: f.client.id } });
      assert.equal(row.taxCode, code); assert.equal(row.legalName, "Công ty TNHH Mẫu"); assert.equal(row.website, "https://example.vn"); assert.equal(row.version, v + 1);
      assert.deepEqual((await changes(f.client.id)).filter((c) => ["taxCode", "legalName", "website"].includes(c.field)).map((c) => c.field).sort(), ["legalName", "taxCode", "website"]);
      for (const bad of [{ taxCode: "12345" }, { website: "javascript:alert(1)" }, { notes: "x".repeat(2001) }]) {
        const failed = await updateClientIdentity(db, pic, { clientId: f.client.id, expectedVersion: v + 1, ...bad });
        assert.ok("error" in failed);
      }
      assert.equal(await version(f.client.id), v + 1);
      const faulty = db.$extends({ query: { clientFieldChange: { createMany() { throw new Error("Injected history failure"); } } } }) as unknown as typeof db;
      await assert.rejects(updateClientIdentity(faulty, pic, { clientId: f.client.id, expectedVersion: v + 1, shortName: "Mẫu" }), /Injected history failure/);
      const after = await db.client.findUniqueOrThrow({ where: { id: f.client.id } });
      assert.equal(after.shortName, null); assert.equal(after.version, v + 1);
    });

    await t.test("stale version is refused and roles follow EDIT and ARCHIVE_CLIENT", async () => {
      const c = await make("Roles");
      assert.match((await updateClientIdentity(db, pic, { clientId: c.id, expectedVersion: 5, legalName: "X" }) as { error: string }).error, STALE);
      assert.match((await updateClientIdentity(db, user, { clientId: c.id, expectedVersion: 0, legalName: "X" }) as { error: string }).error, DENIED);
      assert.ok("ok" in await updateClientIdentity(db, manager, { clientId: c.id, expectedVersion: 0, legalName: "Manager" }));
      assert.ok("ok" in await updateClientIdentity(db, admin, { clientId: c.id, expectedVersion: 1, legalName: "Admin" }));
      assert.match((await addClientAlias(db, user, { clientId: c.id, name: `${prefix} denied` }) as { error: string }).error, DENIED);
      assert.match((await archiveClient(db, pic, { clientId: c.id, expectedVersion: 2 }) as { error: string }).error, DENIED);
      assert.match((await archiveClient(db, user, { clientId: c.id, expectedVersion: 2 }) as { error: string }).error, DENIED);
      assert.match((await archiveClient(db, manager, { clientId: c.id, expectedVersion: 1 }) as { error: string }).error, STALE);
      assert.ok("ok" in await archiveClient(db, manager, { clientId: c.id, expectedVersion: 2, reason: "Ngừng hợp tác" }));
      assert.match((await restoreClient(db, pic, { clientId: c.id, expectedVersion: 3 }) as { error: string }).error, DENIED);
      assert.ok("ok" in await restoreClient(db, admin, { clientId: c.id, expectedVersion: 3 }));
    });

    await t.test("tax code is unique after normalization, also under concurrent saves", async () => {
      const a = await make("Tax A"); const b = await make("Tax B"); const c = await make("Tax C");
      const code = taxCode();
      assert.ok("ok" in await updateClientIdentity(db, pic, { clientId: a.id, expectedVersion: 0, taxCode: code }));
      assert.match((await updateClientIdentity(db, pic, { clientId: b.id, expectedVersion: 0, taxCode: ` ${code}` }) as { error: string }).error, /Mã số thuế đã thuộc khách khác/);
      const race = `${taxCode()}-001`;
      const results = await Promise.all([b, c].map((client) => updateClientIdentity(db, pic, { clientId: client.id, expectedVersion: 0, taxCode: race })));
      assert.equal(results.filter((r) => "ok" in r).length, 1);
      assert.equal(await db.client.count({ where: { taxCode: race } }), 1);
    });

    await t.test("alias keys are unique, cannot reuse another client's name and survive a race", async () => {
      const a = await make("Alias A"); const b = await make("Alias B"); const c = await make("Alias C");
      const name = `${prefix} Viet Thinh`;
      const added = await addClientAlias(db, pic, { clientId: a.id, name });
      assert.ok("ok" in added);
      assert.match((await addClientAlias(db, pic, { clientId: b.id, name: `  ${name.toUpperCase()} JSC ` }) as { error: string }).error, /đã thuộc khách khác/);
      assert.match((await addClientAlias(db, pic, { clientId: a.id, name }) as { error: string }).error, /đã có/);
      assert.match((await addClientAlias(db, pic, { clientId: a.id, name: `Công ty ${prefix} Alias B` }) as { error: string }).error, /trùng tên khách/);
      const race = `${prefix} Race Alias`;
      const results = await Promise.all([b, c].map((client) => addClientAlias(db, pic, { clientId: client.id, name: race })));
      assert.equal(results.filter((r) => "ok" in r).length, 1);
      const alias = await db.clientAlias.findFirstOrThrow({ where: { clientId: a.id } });
      assert.ok("ok" in await removeClientAlias(db, pic, { clientId: a.id, aliasId: alias.id }));
      const log = await changes(a.id, "aliases");
      assert.deepEqual(log.map((c) => c.newValue), [[name], []]);
      const list = await loadClientList(db, { q: "viet thinh" }, await getCrmSettings(db), new Date());
      assert.equal(list.rows.some((row) => row.id === a.id), false);
      assert.ok("ok" in await addClientAlias(db, pic, { clientId: a.id, name }));
      const found = await loadClientList(db, { q: `${prefix} viet thinh` }, await getCrmSettings(db), new Date());
      assert.deepEqual(found.rows.map((row) => row.id), [a.id]);
    });

    await t.test("parent cycle is blocked across requests and concurrent writes, with at most 3 levels", async () => {
      const p = await make("Parent P"); const q = await make("Parent Q"); const r = await make("Parent R"); const s = await make("Parent S");
      assert.ok("ok" in await updateClientIdentity(db, pic, { clientId: q.id, expectedVersion: 0, parentClientId: p.id }));
      assert.ok("ok" in await updateClientIdentity(db, pic, { clientId: r.id, expectedVersion: 0, parentClientId: q.id }));
      assert.match((await updateClientIdentity(db, pic, { clientId: s.id, expectedVersion: 0, parentClientId: r.id }) as { error: string }).error, /3 cấp/);
      assert.match((await updateClientIdentity(db, pic, { clientId: p.id, expectedVersion: 0, parentClientId: r.id }) as { error: string }).error, /vòng/);
      assert.match((await updateClientIdentity(db, pic, { clientId: p.id, expectedVersion: 0, parentClientId: p.id }) as { error: string }).error, /chính/);
      const x = await make("Parent X"); const y = await make("Parent Y");
      const results = await Promise.all([updateClientIdentity(db, pic, { clientId: x.id, expectedVersion: 0, parentClientId: y.id }), updateClientIdentity(db, pic, { clientId: y.id, expectedVersion: 0, parentClientId: x.id })]);
      assert.equal(results.filter((r) => "ok" in r).length, 1);
      const [xr, yr] = await Promise.all([db.client.findUniqueOrThrow({ where: { id: x.id } }), db.client.findUniqueOrThrow({ where: { id: y.id } })]);
      assert.ok(!(xr.parentClientId === y.id && yr.parentClientId === x.id));
      const z = await make("Parent Z");
      assert.ok("ok" in await archiveClient(db, admin, { clientId: z.id, expectedVersion: 0 }));
      assert.match((await updateClientIdentity(db, pic, { clientId: s.id, expectedVersion: 0, parentClientId: z.id }) as { error: string }).error, /lưu trữ/);
      const log = await changes(q.id, "parentClientId");
      assert.deepEqual(log[0].newValue, { id: p.id, name: p.name });
      const profile = (await loadClientProfile(db, p.id, await getCrmSettings(db), new Date()))!;
      assert.deepEqual(profile.metricsScope, { kind: "GROUP", childCount: 2 });
      assert.deepEqual(profile.childClients.map((c) => c.id), [q.id]);
    });

    await t.test("PIC, team and potential changes are logged with names and keys", async () => {
      const c = await make("History");
      assert.ok("ok" in await changeClientPicOrTeam(db, manager, { clientId: c.id, expectedVersion: 0, picAccountId: f.otherAccount.id, responsibleTeamId: f.team.id }, { notify: async () => {} }));
      const pics = await changes(c.id, "picAccountId");
      assert.deepEqual(pics.map((x) => [x.oldValue, x.newValue]), [[{ id: f.picAccount.id, name: f.picAccount.name }, { id: f.otherAccount.id, name: f.otherAccount.name }]]);
      assert.equal((await changes(c.id, "responsibleTeamId")).length, 0);
      const scale = await db.crmSetting.findUnique({ where: { key: "tier.potentialScale" } });
      const level = Array.isArray(scale?.value) ? (scale!.value as { key: string }[])[0]?.key : undefined;
      if (level) {
        assert.ok("ok" in await scorePotential(db, manager, { clientId: c.id, level }));
        assert.deepEqual((await changes(c.id, "potentialLevel")).map((x) => x.newValue), [level]);
      }
    });

    await t.test("archived client leaves Review, cadence and new Opportunities; restore keeps history", async () => {
      const now = new Date("2026-11-10T09:00:00+07:00");
      const inReview = async () => Object.values((await loadWeeklyReviewGroups(db, admin, { team: "all", pic: "all" }, now)).groups).flat().some((row) => row.client.id === f.client.id);
      assert.equal(await inReview(), true);
      // Scope the job to this fixture so the shared mock clients are never touched.
      const scoped = db.$extends({ query: {
        client: { findMany({ args, query }) { return query({ ...args, where: { AND: [args.where ?? {}, { id: f.client.id }] } }); } },
        meeting: { findMany() { return Promise.resolve([]); } },
      } }) as unknown as typeof db;
      await db.client.update({ where: { id: f.client.id }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
      const v = await version(f.client.id);
      assert.ok("ok" in await archiveClient(db, manager, { clientId: f.client.id, expectedVersion: v, reason: "Tạm dừng" }));
      assert.equal(await inReview(), false);
      const archivedRun = await runCrmReminderJob(scoped, { now });
      assert.equal(archivedRun.cadenceTasks, 0);
      assert.equal(await db.cadenceReminder.count({ where: { clientId: f.client.id } }), 0);
      const open = await openOpportunity(db, pic, { clientId: f.client.id, programTypeCode: "MICE", expectedYear: 2027, expectedMonth: 3, source: "OTHER", demandSignal: "Test" });
      assert.deepEqual(open, { error: CLIENT_ARCHIVED });
      assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: f.opportunity.id } })).outcome, null);
      const hidden = await loadClientList(db, { q: prefix }, await getCrmSettings(db), now);
      assert.equal(hidden.rows.some((row) => row.id === f.client.id), false);
      const archivedList = await loadClientList(db, { q: prefix, lifecycle: "ARCHIVED" }, await getCrmSettings(db), now);
      assert.ok(archivedList.rows.some((row) => row.id === f.client.id && row.lifecycle === "ARCHIVED"));
      const before = await db.clientFieldChange.count({ where: { clientId: f.client.id } });
      assert.ok("ok" in await restoreClient(db, manager, { clientId: f.client.id, expectedVersion: v + 1 }));
      assert.equal(await inReview(), true);
      const restoredRun = await runCrmReminderJob(scoped, { now });
      assert.equal(restoredRun.cadenceTasks, 1);
      const log = await changes(f.client.id, "archived");
      assert.deepEqual(log.map((c) => [c.oldValue, c.newValue]), [[null, { reason: "Tạm dừng" }], [{ reason: "Tạm dừng" }, null]]);
      assert.equal(await db.clientFieldChange.count({ where: { clientId: f.client.id } }), before + 1);
    });

    await t.test("industry and source catalogs use CAS, history and refuse removing used items", async () => {
      const ind = await db.crmSetting.findUnique({ where: { key: "client.industries" } });
      const v0 = ind?.version ?? 0;
      const base = (ind?.value as { label: string; active: boolean }[] | undefined) ?? [];
      const label = `${prefix} Ngân hàng`;
      const first = await saveCrmSetting(db, { key: "client.industries", value: [...base, { label, active: true }], expectedVersion: v0, actor: f.admin });
      assert.deepEqual(first, { ok: true, version: v0 + 1 });
      assert.match((await saveCrmSetting(db, { key: "client.industries", value: [...base], expectedVersion: v0, actor: f.admin }) as { error: string }).error, STALE);
      const history = await db.crmSettingChange.findMany({ where: { key: "client.industries", userId: f.admin.id } });
      assert.equal(history.length, 1);
      assert.ok("error" in await saveCrmSetting(db, { key: "client.industries", value: [{ label: "A", active: true }, { label: " a ", active: true }], expectedVersion: v0 + 1, actor: f.admin }));
      const c = await make("Catalog");
      await db.client.update({ where: { id: c.id }, data: { industry: "Ngành cũ ngoài danh mục" } });
      assert.ok("ok" in await updateClientProfile(db, pic, { clientId: c.id, expectedVersion: 0, valuedMost: "Ý tưởng" }));
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: c.id } })).industry, "Ngành cũ ngoài danh mục");
      assert.match((await updateClientProfile(db, pic, { clientId: c.id, expectedVersion: 1, industry: "Ngành tự gõ" }) as { error: string }).error, /danh mục/);
      assert.ok("ok" in await updateClientProfile(db, pic, { clientId: c.id, expectedVersion: 1, industry: label }));
      assert.match((await saveCrmSetting(db, { key: "client.industries", value: [...base], expectedVersion: v0 + 1, actor: f.admin }) as { error: string }).error, /tắt mục/);
      assert.deepEqual(await saveCrmSetting(db, { key: "client.industries", value: [...base, { label, active: false }], expectedVersion: v0 + 1, actor: f.admin }), { ok: true, version: v0 + 2 });
      const src = await db.crmSetting.findUnique({ where: { key: "client.sources" } });
      const sources = (src?.value as { label: string; active: boolean }[] | undefined) ?? [];
      assert.ok("ok" in await saveCrmSetting(db, { key: "client.sources", value: [...sources, { label: `${prefix} Giới thiệu`, active: true }], expectedVersion: src?.version ?? 0, actor: f.admin }));
      assert.match((await updateClientIdentity(db, pic, { clientId: c.id, expectedVersion: 2, acquisitionSource: "Tự gõ" }) as { error: string }).error, /danh mục/);
      assert.ok("ok" in await updateClientIdentity(db, pic, { clientId: c.id, expectedVersion: 2, acquisitionSource: `${prefix} Giới thiệu`, referredBy: "Đối tác" }));
      assert.deepEqual((await changes(c.id, "acquisitionSource")).map((x) => x.newValue), [`${prefix} Giới thiệu`]);
    });

    await t.test("tags and agencies: catalog uniqueness, inactive items, client links, history and lost-to agency", async () => {
      const tag = await saveClientTag(db, { label: `${prefix} VIP`, active: true, order: 0 }, f.admin);
      assert.ok("id" in tag); tagIds.push(tag.id);
      assert.ok("error" in await saveClientTag(db, { label: `${prefix} vip`.toUpperCase(), active: true, order: 1 }, f.admin));
      const a = await make("Tag A"); const b = await make("Tag B");
      assert.ok("ok" in await setClientTags(db, pic, { clientId: a.id, expectedVersion: 0, tagIds: [tag.id] }));
      assert.match((await setClientTags(db, pic, { clientId: a.id, expectedVersion: 0, tagIds: [] }) as { error: string }).error, STALE);
      assert.match((await setClientTags(db, user, { clientId: a.id, expectedVersion: 1, tagIds: [] }) as { error: string }).error, DENIED);
      assert.ok("id" in await saveClientTag(db, { id: tag.id, label: `${prefix} VIP`, active: false, order: 0 }, f.admin));
      assert.ok("ok" in await setClientTags(db, pic, { clientId: a.id, expectedVersion: 1, tagIds: [tag.id] }));
      assert.match((await setClientTags(db, pic, { clientId: b.id, expectedVersion: 0, tagIds: [tag.id] }) as { error: string }).error, /nhãn đang dùng/);
      assert.deepEqual((await changes(a.id, "tags")).map((x) => x.newValue), [[`${prefix} VIP`]]);
      assert.equal(await db.crmSettingChange.count({ where: { key: `clientTag.${tag.id}` } }), 2);
      const list = await loadClientList(db, { q: prefix, tagId: tag.id }, await getCrmSettings(db), new Date());
      assert.deepEqual(list.rows.map((row) => row.id), [a.id]);

      const agency = await saveCompetitor(db, { name: `${prefix} Agency`, active: true }, f.admin);
      assert.ok("id" in agency); competitorIds.push(agency.id);
      assert.ok("error" in await saveCompetitor(db, { name: ` ${prefix} agency `, active: true }, f.admin));
      assert.ok("ok" in await saveClientCompetitor(db, pic, { clientId: a.id, competitorId: agency.id, note: "Đang làm YEP", since: new Date("2025-01-01T00:00:00Z") }));
      assert.ok("ok" in await saveClientCompetitor(db, pic, { clientId: a.id, competitorId: agency.id, note: "Đổi ghi chú" }));
      assert.equal((await db.clientCompetitor.findFirstOrThrow({ where: { clientId: a.id } })).note, "Đổi ghi chú");
      assert.deepEqual((await changes(a.id, "competitors")).map((x) => x.newValue), [[`${prefix} Agency`]]);
      assert.ok("ok" in await removeClientCompetitor(db, pic, { clientId: a.id, competitorId: agency.id }));

      assert.match((await setOpportunityCompetitors(db, user, { opportunityId: f.opportunity.id, competitorIds: [agency.id] }) as { error: string }).error, DENIED);
      assert.ok("ok" in await setOpportunityCompetitors(db, pic, { opportunityId: f.opportunity.id, competitorIds: [agency.id] }));
      const reason = await db.crmReason.findFirstOrThrow({ where: { group: "LOST", label: "Khác" } });
      const opp = await db.opportunity.findUniqueOrThrow({ where: { id: f.opportunity.id } });
      assert.ok("error" in await closeOpportunity(db, pic, { opportunityId: opp.id, expectedVersion: opp.version, outcome: "CUSTOMER_CANCELLED", reasonId: reason.id, note: "x", winnerCompetitorId: agency.id }));
      const closed = await closeOpportunity(db, pic, { opportunityId: opp.id, expectedVersion: opp.version, outcome: "LOST_COMPETITIVE", reasonId: reason.id, note: "Thua giá", winnerCompetitorId: agency.id });
      assert.ok("ok" in closed);
      const rows = await db.opportunityCompetitor.findMany({ where: { opportunityId: opp.id } });
      assert.deepEqual(rows.map((r) => [r.competitorId, r.isWinner]), [[agency.id, true]]);
    });

    await t.test("the database enforces tax code uniqueness even without the service", async () => {
      const a = await make("Raw A"); const b = await make("Raw B");
      const code = taxCode();
      await db.client.update({ where: { id: a.id }, data: { taxCode: code } });
      await assert.rejects(db.client.update({ where: { id: b.id }, data: { taxCode: code } }), (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");
    });
  } finally {
    const users = await db.user.findMany({ where: { email: { startsWith: `${prefix}-`, endsWith: "@test.invalid" } }, select: { id: true } });
    await db.crmSettingChange.deleteMany({ where: { OR: [{ userId: { in: users.map((u) => u.id) } }, { key: { in: [...tagIds.map((id) => `clientTag.${id}`), ...competitorIds.map((id) => `competitor.${id}`)] } }] } });
    for (const key of settingKeys) {
      const original = settingsBefore.find((row) => row.key === key);
      if (original) await db.crmSetting.update({ where: { key }, data: { value: original.value as Prisma.InputJsonValue, version: original.version, updatedById: original.updatedById, updatedAt: original.updatedAt } });
      else await db.crmSetting.deleteMany({ where: { key } });
    }
    await cleanupCrmFixture(db, prefix);
    await db.clientTagLink.deleteMany({ where: { tagId: { in: tagIds } } });
    await db.clientTag.deleteMany({ where: { id: { in: tagIds } } });
    await db.clientCompetitor.deleteMany({ where: { competitorId: { in: competitorIds } } });
    await db.opportunityCompetitor.deleteMany({ where: { competitorId: { in: competitorIds } } });
    await db.competitor.deleteMany({ where: { id: { in: competitorIds } } });
    for (const key of settingKeys) {
      const original = settingsBefore.find((row) => row.key === key);
      const now = await db.crmSetting.findUnique({ where: { key } });
      assert.deepEqual(now, original ?? null, `${key} restored`);
    }
    await db.$disconnect();
  }
});
