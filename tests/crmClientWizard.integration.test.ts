import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClientWithProfile, findClientDuplicates } from "../lib/crm/clientService";
import { parsePotentialScale } from "../lib/crm/settingsSchema";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

const taxCode = () => String(randomInt(1_000_000_000, 9_999_999_999));

test("crm51 new client wizard: one transaction, duplicates, races and permissions", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const prefix = `wizard-${randomUUID()}`;
  const tagIds: string[] = [];
  const notices: { ids: string[]; message: string }[] = [];
  const effects = { notify: async (ids: string[], data: { message: string }) => { notices.push({ ids, message: data.message }); } };
  try {
    const f = await seedCrmFixture(db, prefix);
    const actor = (user: { id: string; name: string }, role: string, accountId: string | null, managedTeamIds: string[]) => ({ id: user.id, name: user.name, role, accountId, managedTeamIds, isDataSteward: false });
    const admin = actor(f.admin, "ADMIN", null, []);
    const manager = actor(f.manager, "ACCOUNT", f.otherAccount.id, [f.team.id]);
    const pic = actor(f.pic, "ACCOUNT", f.picAccount.id, []);
    const user = actor(f.outsider, "USER", null, []);
    const scale = parsePotentialScale((await db.crmSetting.findUnique({ where: { key: "tier.potentialScale" } }))?.value) ?? [];

    await t.test("name only creates a bare client and nothing else", async () => {
      const result = await createClientWithProfile(db, pic, { name: `  ${prefix}   Chỉ   tên ` }, effects);
      assert.ok("ok" in result, JSON.stringify(result));
      const row = await db.client.findUniqueOrThrow({ where: { id: result.id }, include: { clientAliases: true, clientTagLinks: true, taskClient: true, clientFieldChanges: true } });
      assert.equal(row.name, `${prefix} Chỉ tên`);
      assert.equal(row.taxCode, null); assert.equal(row.picAccountId, null); assert.equal(row.potentialLevel, null);
      assert.deepEqual([row.clientAliases.length, row.clientTagLinks.length, row.taskClient.length, row.clientFieldChanges.length], [0, 0, 0, 0]);
    });

    await t.test("all fields save together with history, alias, tags and the next task", async () => {
      const tag = await db.clientTag.create({ data: { label: `${prefix} Tài chính`, active: true } });
      tagIds.push(tag.id);
      const code = taxCode();
      const level = scale[0]?.key ?? null;
      const due = new Date("2026-12-01T00:00:00+07:00");
      const result = await createClientWithProfile(db, manager, {
        name: `${prefix} Ngân hàng Đầy Đủ`, taxCode: ` ${code} `, teamName: `${prefix} DD Bank`, industry: "Ngân hàng", parentClientId: f.client.id,
        acquisitionSource: "Giới thiệu", referredBy: "Anh A", potentialLevel: level, picAccountId: f.picAccount.id, responsibleTeamId: f.team.id,
        tagIds: [tag.id], next: { title: "Gửi hồ sơ năng lực", assigneeId: f.pic.id, dueDate: due },
      }, effects);
      assert.ok("ok" in result, JSON.stringify(result));
      const row = await db.client.findUniqueOrThrow({ where: { id: result.id }, include: { clientAliases: true, clientTagLinks: true, taskClient: true, clientFieldChanges: true, clientPotentialScores: true } });
      assert.equal(row.taxCode, code); assert.equal(row.parentClientId, f.client.id); assert.equal(row.picAccountId, f.picAccount.id); assert.equal(row.responsibleTeamId, f.team.id);
      assert.equal(row.industry, "Ngân hàng"); assert.equal(row.acquisitionSource, "Giới thiệu"); assert.equal(row.referredBy, "Anh A");
      assert.deepEqual(row.clientAliases.map((a) => a.name), [`${prefix} DD Bank`]);
      assert.deepEqual(row.clientTagLinks.map((l) => l.tagId), [tag.id]);
      assert.equal(row.taskClient.length, 1);
      assert.deepEqual([row.taskClient[0].title, row.taskClient[0].crmKind, row.taskClient[0].assigneeId, row.taskClient[0].creatorId, row.taskClient[0].dueDate?.toISOString()], ["Gửi hồ sơ năng lực", "NEXT_STEP", f.pic.id, f.manager.id, due.toISOString()]);
      const fields = row.clientFieldChanges.map((c) => c.field).sort();
      for (const field of ["taxCode", "industry", "acquisitionSource", "referredBy", "parentClientId", "picAccountId", "responsibleTeamId", "aliases", "tags"]) assert.ok(fields.includes(field), field);
      assert.ok(row.clientFieldChanges.every((c) => c.actorId === f.manager.id && c.oldValue === null));
      if (level) { assert.equal(row.potentialLevel, level); assert.equal(row.clientPotentialScores.length, 1); assert.ok(fields.includes("potentialLevel")); }
      assert.deepEqual(notices.at(-1)?.ids, [f.pic.id]);
    });

    await t.test("same tax code is blocked and nothing is written", async () => {
      const code = taxCode();
      const first = await createClientWithProfile(db, admin, { name: `${prefix} MST Một`, taxCode: code }, effects);
      assert.ok("ok" in first);
      const before = await db.client.count({ where: { name: { startsWith: prefix } } });
      const second = await createClientWithProfile(db, admin, { name: `${prefix} Hoàn toàn khác`, taxCode: code, allowSimilar: true }, effects);
      assert.ok("error" in second); assert.equal(second.field, "taxCode");
      assert.equal(second.duplicates?.[0]?.id, first.id); assert.equal(second.duplicates?.[0]?.reason, "TAX_CODE");
      assert.equal(await db.client.count({ where: { name: { startsWith: prefix } } }), before);
      const live = await findClientDuplicates(db, { taxCode: code });
      assert.deepEqual(live.map((d) => [d.id, d.reason, d.exact]), [[first.id, "TAX_CODE", true]]);
    });

    await t.test("exact name and team alias are blocked, a similar name needs Vẫn tạo mới", async () => {
      const base = await createClientWithProfile(db, admin, { name: `${prefix} Công ty TNHH Sao Mai`, teamName: `${prefix} SM` }, effects);
      assert.ok("ok" in base);
      const exact = await createClientWithProfile(db, admin, { name: `${prefix} CÔNG TY TNHH SAO MAI`, allowSimilar: true }, effects);
      assert.ok("error" in exact); assert.equal(exact.field, "name");
      const alias = await createClientWithProfile(db, admin, { name: `${prefix} SM`, allowSimilar: true }, effects);
      assert.ok("error" in alias); assert.equal(alias.duplicates?.[0]?.reason, "ALIAS");
      const similar = await createClientWithProfile(db, admin, { name: `${prefix} Sao Mai JSC` }, effects);
      assert.ok("error" in similar); assert.equal(similar.field, "name"); assert.equal(similar.duplicates?.[0]?.id, base.id); assert.equal(similar.duplicates?.[0]?.exact, false);
      const forced = await createClientWithProfile(db, admin, { name: `${prefix} Sao Mai JSC`, allowSimilar: true }, effects);
      assert.ok("ok" in forced, JSON.stringify(forced));
    });

    await t.test("two parallel creates with the same name leave exactly one client", async () => {
      const name = `${prefix} Song Song`;
      const results = await Promise.all([createClientWithProfile(db, admin, { name }, effects), createClientWithProfile(db, manager, { name }, effects)]);
      assert.equal(results.filter((r) => "ok" in r).length, 1);
      const failed = results.find((r) => "error" in r);
      assert.ok(failed && "error" in failed && failed.field === "name");
      assert.equal(await db.client.count({ where: { name } }), 1);
    });

    await t.test("USER role is blocked; an ACCOUNT may self-assign but not pick another PIC or score", async () => {
      const denied = await createClientWithProfile(db, user, { name: `${prefix} Bị chặn` }, effects);
      assert.ok("error" in denied);
      assert.equal(await db.client.count({ where: { name: `${prefix} Bị chặn` } }), 0);
      const self = await createClientWithProfile(db, pic, { name: `${prefix} Tự nhận`, picAccountId: f.picAccount.id }, effects);
      assert.ok("ok" in self, JSON.stringify(self));
      const other = await createClientWithProfile(db, pic, { name: `${prefix} Giao người khác`, picAccountId: f.otherAccount.id }, effects);
      assert.ok("error" in other); assert.equal(other.field, "picAccountId");
      if (scale[0]) {
        const scored = await createClientWithProfile(db, pic, { name: `${prefix} Tự chấm`, picAccountId: f.picAccount.id, potentialLevel: scale[0].key }, effects);
        assert.ok("error" in scored); assert.equal(scored.field, "potentialLevel");
      }
      assert.equal(await db.client.count({ where: { name: { in: [`${prefix} Giao người khác`, `${prefix} Tự chấm`] } } }), 0);
    });

    await t.test("a failing step rolls back the whole create", async () => {
      const name = `${prefix} Lỗi việc`;
      const failed = await createClientWithProfile(db, admin, { name, next: { title: "X", assigneeId: "missing-user", dueDate: new Date() } }, effects);
      assert.ok("error" in failed); assert.equal(failed.field, "next");
      assert.equal(await db.client.count({ where: { name } }), 0);
    });
  } finally {
    await cleanupCrmFixture(db, prefix);
    await db.clientTagLink.deleteMany({ where: { tagId: { in: tagIds } } });
    await db.clientTag.deleteMany({ where: { id: { in: tagIds } } });
    await db.$disconnect();
  }
});
