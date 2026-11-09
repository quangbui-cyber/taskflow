import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { editOpportunity, changeOpportunityPicOrTeam } from "../lib/crm/opportunityService";
import { openOpportunity, closeOpportunity } from "../lib/crm/opportunityWorkflow";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("Opportunity edit and assignment authorize persisted ownership and version", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb(); const prefix = randomUUID();
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const pic = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [] as string[], isDataSteward: false };
    const manager = { ...pic, id: f.manager.id, name: f.manager.name, accountId: f.otherAccount.id, managedTeamIds: [f.team.id] };
    const outsider = { ...pic, id: f.outsider.id, accountId: null };
    const admin = { ...pic, id: f.admin.id, role: "ADMIN" };
    const open = async (patch = {}) => { const r = await openOpportunity(db, pic, { clientId: f.client.id, programTypeCode: "MICE", expectedYear: 2027, expectedMonth: 3, source: "REPEAT", demandSignal: "Confirmed need", ...patch }); assert.ok("ok" in r); return r.opportunityId; };
    const opportunityId = await open();
    const base = { opportunityId, expectedVersion: 0 };
    const read = () => db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
    await t.test("PIC rename and budgets increment the version", async () => {
      assert.deepEqual(await editOpportunity(db, pic, { ...base, name: "Reviewed opportunity", budgetMin: 100, budgetMax: 200 }), { ok: true, version: 1 });
      const row = await read(); assert.equal(row.name, "Reviewed opportunity"); assert.equal(Number(row.budgetMin), 100); assert.equal(Number(row.budgetMax), 200); assert.equal(row.stage, "CARE"); assert.equal(row.outcome, null);
    });
    await t.test("outsider valid id denied without changing the row", async () => {
      const before = await read(); assert.deepEqual(await editOpportunity(db, outsider, { ...base, expectedVersion: 1, name: "IDOR" }), { error: "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team." }); assert.deepEqual(await read(), before);
    });
    await t.test("stale version rejected", async () => {
      assert.deepEqual(await editOpportunity(db, pic, { ...base, name: "Stale" }), { error: "Dữ liệu vừa được người khác cập nhật. Tải lại trang để xem bản mới." });
    });
    await t.test("budget lower bound above retained upper bound rejected atomically", async () => {
      const before = await read(); assert.ok("error" in await editOpportunity(db, pic, { ...base, expectedVersion: 1, budgetMin: 300 })); assert.deepEqual(await read(), before);
    });
    await t.test("buying unit from another client rejected", async () => {
      const other = await db.client.create({ data: { name: `${prefix} Other client` } });
      const unit = await db.buyingUnit.create({ data: { clientId: other.id, name: "Other unit" } });
      assert.ok("error" in await editOpportunity(db, pic, { ...base, expectedVersion: 1, buyingUnitId: unit.id }));
      assert.equal((await read()).buyingUnitId, null);
    });
    await t.test("closed Opportunity cannot be edited", async () => {
      const closedId = await open(); const reason = await db.crmReason.findFirstOrThrow({ where: { group: "CANCELLED", active: true, requiresNote: false } });
      assert.ok("ok" in await closeOpportunity(db, pic, { opportunityId: closedId, expectedVersion: 0, outcome: "CUSTOMER_CANCELLED", reasonId: reason.id }));
      assert.deepEqual(await editOpportunity(db, admin, { opportunityId: closedId, expectedVersion: 1, name: "Reopen" }), { error: "Cơ hội đã kết thúc không mở lại được." });
    });
    await t.test("expected-event program cannot change", async () => {
      const event = await db.expectedEvent.create({ data: { clientId: f.client.id, programTypeCode: "MICE", precision: "MONTH", year: 2027, month: 3, source: "CLIENT_CONFIRMED" } });
      const linkedId = await open({ expectedEventId: event.id });
      assert.deepEqual(await editOpportunity(db, pic, { opportunityId: linkedId, expectedVersion: 0, programTypeCode: "YEP" }), { error: "Cơ hội đang gắn sự kiện dự kiến, không đổi loại chương trình được." });
    });
    await t.test("PIC cannot reassign; team manager adds new PIC member and one post-commit notification", async () => {
      const assignment = { ...base, expectedVersion: 1, picAccountId: f.otherAccount.id, responsibleTeamId: f.team.id };
      assert.ok("error" in await changeOpportunityPicOrTeam(db, pic, assignment));
      // Assign from manager to the original PIC through a fresh Opportunity to verify a different recipient.
      const target = await open();
      await db.opportunity.update({ where: { id: target }, data: { picAccountId: f.otherAccount.id } });
      await db.opportunityMember.deleteMany({ where: { opportunityId: target, userId: f.pic.id } });
      const input = { opportunityId: target, expectedVersion: 0, picAccountId: f.picAccount.id, responsibleTeamId: f.team.id };
      const result = await changeOpportunityPicOrTeam(db, manager, input, { notify: async (ids, data) => {
        assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: target } })).picAccountId, f.picAccount.id);
        await db.notification.createMany({ data: ids.map((userId) => ({ userId, ...data })) });
      } });
      assert.deepEqual(result, { ok: true, version: 1 });
      assert.equal(await db.opportunityMember.count({ where: { opportunityId: target, userId: f.pic.id } }), 1);
      const notice = await db.notification.findMany({ where: { opportunityId: target, type: "CRM_PIC_ASSIGNED", userId: f.pic.id } });
      assert.equal(notice.length, 1); assert.equal(notice[0].message, "Bạn được giao phụ trách Cơ hội MICE 2027.");
      assert.ok("error" in await changeOpportunityPicOrTeam(db, manager, input));
    });
    await t.test("Admin empty PIC rejected without changing the row", async () => {
      const before = await read(); assert.ok("error" in await changeOpportunityPicOrTeam(db, admin, { ...base, expectedVersion: 1, picAccountId: "", responsibleTeamId: f.team.id })); assert.deepEqual(await read(), before);
    });
  } finally { await cleanupCrmFixture(db, prefix); await db.$disconnect(); }
});
