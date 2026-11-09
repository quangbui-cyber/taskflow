import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadOpportunityFilterOptions, loadOpportunityList, parseOpportunityListParams } from "../lib/crm/opportunityList";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("Opportunity query parameters whitelist views and bound untrusted values", () => {
  assert.deepEqual(parseOpportunityListParams({ view: "BOGUS", page: "-3" }), { view: "OPEN", page: 1, picAccountId: null, teamId: null, programTypeCode: null });
  assert.equal(parseOpportunityListParams({ page: "1000000", pic: ` ${"x".repeat(90)} ` }).page, 100);
  assert.equal(parseOpportunityListParams({ pic: ` ${"x".repeat(90)} ` }).picAccountId?.length, 64);
  assert.equal(parseOpportunityListParams({ page: "2.5", view: ["CLOSED"] }).page, 1);
});

test("Opportunity list preserves company visibility, lifecycle data and global pagination", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const prefix = randomUUID();
  const inactiveCode = `test-${prefix}`;
  const now = new Date("2026-11-13T02:00:00Z");
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.opportunity.delete({ where: { id: f.opportunity.id } });
    const unit = await db.buyingUnit.create({ data: { clientId: f.client.id, name: "Events" } });
    const reason = await db.crmReason.findFirstOrThrow({ where: { group: "LOST", active: true } });
    const create = (name: string, patch = {}) => db.opportunity.create({ data: { name: `${prefix} ${name}`, clientId: f.client.id, programTypeCode: "MICE", expectedYear: 2026, expectedMonth: 11, source: "OTHER", demandSignal: "synthetic", picAccountId: f.picAccount.id, ...patch } });
    const a = await create("A", { stage: "CARE", buyingUnitId: unit.id, budgetMin: 1_200_000_000, budgetMax: 1_500_000_000 });
    const b = await create("B", { stage: "BRIEF" });
    const c = await create("C", { stage: "BIDDING" });
    const d = await create("D", { outcome: "WON", contractValue: 1_200_000_000, closedAt: new Date("2026-11-12T03:00:00Z") });
    const e = await create("E", { outcome: "LOST_COMPETITIVE", outcomeReasonId: reason.id, outcomeNote: "Giá", closedAt: new Date("2026-11-11T03:00:00Z") });
    const legacy = await create("F", { outcome: "LEGACY_UNCLASSIFIED", legacyStatus: "FAIL", closedAt: new Date("2026-11-10T03:00:00Z") });
    const project = await db.project.create({ data: { name: `${prefix} Project`, ownerId: f.admin.id, sourceOpportunityId: d.id } });
    await db.opportunityStageEvent.createMany({ data: ["2026-11-01T16:30:00Z", "2026-11-08T17:01:00Z"].map(occurredAt => ({ opportunityId: a.id, toStage: "CARE", actorName: "Synthetic", occurredAt: new Date(occurredAt) })) });
    await db.task.createMany({ data: [
      { title: "Next overdue", opportunityId: a.id, creatorId: f.pic.id, dueDate: new Date("2026-11-11T17:00:00Z") },
      { title: "Done", opportunityId: a.id, creatorId: f.pic.id, status: "DONE", dueDate: new Date("2026-11-01") },
      { title: "Cancelled", opportunityId: b.id, creatorId: f.pic.id, status: "CANCELLED", dueDate: new Date("2026-11-01") },
      { title: "Undated", opportunityId: c.id, creatorId: f.pic.id },
    ] });
    const params = (raw = {}) => parseOpportunityListParams({ pic: f.picAccount.id, ...raw });
    await t.test("open rows show no-next first, then dated tasks and undated tasks", async () => {
      const list = await loadOpportunityList(db, params(), now);
      assert.deepEqual(list.openRows?.map(r => r.id), [b.id, a.id, c.id]);
      const row = list.openRows!.find(r => r.id === a.id)!;
      assert.equal(row.nextStep?.title, "Next overdue");
      assert.equal(row.nextStep?.overdue, true);
      assert.equal(row.daysInStage, 4);
      assert.equal(row.budgetMin, 1_200_000_000);
      assert.equal(row.buyingUnitName, "Events");
      assert.equal(row.timingLabel, "11/2026");
      assert.deepEqual((await loadOpportunityList(db, params({ view: "BRIEF" }), now)).openRows?.map(r => r.id), [b.id]);
    });
    await t.test("closed rows preserve legacy and link only the recorded winning Project", async () => {
      const rows = (await loadOpportunityList(db, params({ view: "CLOSED" }), now)).closedRows!;
      assert.deepEqual(rows.map(r => r.id), [d.id, e.id, legacy.id]);
      assert.equal(rows[0].contractValue, 1_200_000_000);
      assert.equal(rows[0].projectId, project.id);
      assert.equal(rows[1].contractValue, null);
      assert.equal(rows[1].reasonLabel, reason.label);
      assert.equal(rows[1].outcomeNote, "Giá");
      assert.equal(rows[2].outcome, "LEGACY_UNCLASSIFIED");
      assert.equal(rows[2].legacyStatus, "FAIL");
    });
    await t.test("team precedence and filters use actual responsible/PIC/client teams", async () => {
      assert.equal((await loadOpportunityList(db, params({ team: f.team.id }), now)).total, 3);
      assert.equal((await loadOpportunityList(db, params({ program: "YEP" }), now)).total, 0);
      await db.opportunity.update({ where: { id: a.id }, data: { picAccountId: null } });
      await db.client.update({ where: { id: f.client.id }, data: { responsibleTeamId: f.team.id } });
      assert.ok((await loadOpportunityList(db, parseOpportunityListParams({ team: f.team.id }), now)).openRows?.some(r => r.id === a.id));
      await db.opportunity.update({ where: { id: a.id }, data: { picAccountId: f.picAccount.id } });
      assert.equal((await loadOpportunityList(db, params({ pic: f.otherAccount.id }), now)).total, 0);
      const otherTeam = await db.salesTeam.create({ data: { name: `${prefix} Alternate` } });
      const otherPic = await db.account.create({ data: { name: `${prefix} Alternate PIC`, teamId: otherTeam.id } });
      try {
        await db.opportunity.update({ where: { id: b.id }, data: { responsibleTeamId: otherTeam.id } });
        assert.equal((await loadOpportunityList(db, params({ team: f.team.id }), now)).total, 2);
        assert.deepEqual((await loadOpportunityList(db, params({ team: otherTeam.id }), now)).openRows?.map(r => r.id), [b.id]);
        await db.opportunity.update({ where: { id: a.id }, data: { picAccountId: otherPic.id } });
        // A present PIC team must take precedence over the client's team.
        const rows = (await loadOpportunityList(db, parseOpportunityListParams({ team: f.team.id }), now)).openRows!;
        assert.equal(rows.some(r => r.id === a.id || r.id === b.id), false);
      } finally {
        await db.opportunity.update({ where: { id: a.id }, data: { picAccountId: f.picAccount.id } });
        await db.opportunity.update({ where: { id: b.id }, data: { responsibleTeamId: null } });
        await db.account.delete({ where: { id: otherPic.id } });
        await db.salesTeam.delete({ where: { id: otherTeam.id } });
      }
    });
    await t.test("global next-step order is applied before the 50-row page boundary", async () => {
      const extra = [];
      for (let i = 0; i < 53; i++) extra.push(await create(`Z${String(i).padStart(2, "0")}`));
      // A name/creation-ordered first page must not displace a late no-next row.
      const first = await loadOpportunityList(db, params(), now);
      const second = await loadOpportunityList(db, params({ page: "2" }), now);
      assert.equal(first.openRows?.length, 50);
      assert.equal(first.hasMore, true);
      assert.equal(second.hasMore, false);
      const ids = [...first.openRows!, ...second.openRows!].map(r => r.id);
      assert.equal(new Set(ids).size, 56);
      assert.equal(ids.at(-2), a.id);
      assert.equal(ids.at(-1), c.id);
      assert.ok(ids.indexOf(extra[52].id) < ids.indexOf(a.id));
    });
    await t.test("filter options retain inactive program types used by Opportunities", async () => {
      await db.programType.create({ data: { code: inactiveCode, label: "Synthetic archived type", color: "#000000", active: false } });
      await create("Archived", { programTypeCode: inactiveCode });
      const options = await loadOpportunityFilterOptions(db);
      assert.ok(options.programTypes.some(r => r.code === inactiveCode));
      assert.ok(options.pics.some(r => r.id === f.picAccount.id));
      assert.ok(options.teams.some(r => r.id === f.team.id));
    });
  } finally {
    try { await cleanupCrmFixture(db, prefix); await db.programType.deleteMany({ where: { code: inactiveCode } }); } finally { await db.$disconnect(); }
  }
});
