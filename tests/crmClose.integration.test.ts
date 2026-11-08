import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openOpportunity, advanceStage, closeOpportunity } from "../lib/crm/opportunityWorkflow";
import type { CrmActor } from "../lib/crm/policy";
import { createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";

test("Opportunity lifecycle is authorized, transactional, audited and terminal", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const prefix = randomUUID();
  const effects = { notify: async () => {} };
  try {
    const f = await seedCrmFixture(db, prefix);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const pic: CrmActor & { name: string } = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
    const outsider = { ...pic, id: f.outsider.id, name: f.outsider.name, accountId: null };
    const openInput = { clientId: f.client.id, programTypeCode: "MICE", expectedYear: 2027, expectedMonth: 3, source: "REPEAT", demandSignal: "Client confirmed event need" };
    const open = async (patch = {}) => {
      const result = await openOpportunity(db, pic, { ...openInput, ...patch });
      assert.ok("ok" in result, JSON.stringify(result));
      if (!("ok" in result)) throw new Error("Open failed");
      return result.opportunityId;
    };

    await t.test("opening records the initial actor/time and actor/PIC membership", async () => {
      const opportunityId = await open();
      const row = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { opportunityMembers: true, opportunityStageEvents: true } });
      assert.equal(row.stage, "CARE");
      assert.equal(row.picAccountId, f.picAccount.id);
      assert.equal(row.responsibleTeamId, f.team.id);
      assert.equal(row.opportunityStageEvents.length, 1);
      assert.equal(row.opportunityStageEvents[0].fromStage, null);
      assert.equal(row.opportunityStageEvents[0].toStage, "CARE");
      assert.equal(row.opportunityStageEvents[0].actorName, f.pic.name);
      assert.ok(row.opportunityStageEvents[0].occurredAt);
      assert.deepEqual(row.opportunityMembers.map((member) => member.userId), [f.pic.id]);
    });

    await t.test("receiving Brief closes only the linked event's pending steps and work", async () => {
      const event = await db.expectedEvent.create({ data: { clientId: f.client.id, programTypeCode: "MICE", precision: "MONTH", year: 2027, month: 3, source: "CLIENT_CONFIRMED" } });
      const other = await db.expectedEvent.create({ data: { clientId: f.client.id, programTypeCode: "YEP", precision: "MONTH", year: 2027, month: 12, source: "CLIENT_CONFIRMED" } });
      const tasks = await Promise.all(["First reminder", "Second reminder"].map((title) => db.task.create({ data: { title, creatorId: f.pic.id, clientId: f.client.id, crmKind: "EVENT_REMINDER" } })));
      for (const [index, task] of tasks.entries()) await db.reminderStep.create({ data: { expectedEventId: event.id, revision: 0, kind: "OFFSET", offsetDays: index ? 30 : 60, dueDate: new Date("2027-01-01"), status: index ? "OPEN" : "PLANNED", taskId: task.id } });
      const untouched = await db.reminderStep.create({ data: { expectedEventId: other.id, revision: 0, kind: "OFFSET", offsetDays: 30, dueDate: new Date("2027-11-01"), status: "PLANNED" } });
      const opportunityId = await open({ expectedEventId: event.id });
      const advanced = await advanceStage(db, pic, { opportunityId, expectedVersion: 0, to: "BRIEF", briefReceivedAt: new Date("2026-11-08") }, { notify: async (_ids, data) => {
        assert.equal(data.type, "CRM_STAGE");
        assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })).stage, "BRIEF");
      } });
      assert.ok("ok" in advanced && advanced.closedReminders === 2);
      assert.equal(await db.reminderStep.count({ where: { expectedEventId: event.id, status: "CLOSED", closedReason: "BRIEF_RECEIVED" } }), 2);
      assert.equal(await db.task.count({ where: { id: { in: tasks.map((task) => task.id) }, status: "CANCELLED", closedReason: "Đã nhận Brief" } }), 2);
      assert.equal((await db.expectedEvent.findUniqueOrThrow({ where: { id: event.id } })).status, "BRIEF_RECEIVED");
      assert.equal((await db.reminderStep.findUniqueOrThrow({ where: { id: untouched.id } })).status, "PLANNED");
      assert.ok("error" in await advanceStage(db, pic, { opportunityId, expectedVersion: 0, to: "BIDDING" }, effects));
      const reason = await db.crmReason.findFirstOrThrow({ where: { group: "LOST", label: "Khác" } });
      assert.ok("error" in await closeOpportunity(db, pic, { opportunityId, expectedVersion: 1, outcome: "LOST_COMPETITIVE", reasonId: reason.id, note: "Test" }));
      assert.ok("ok" in await advanceStage(db, pic, { opportunityId, expectedVersion: 1, to: "BIDDING", winStrategy: "Relevant proof" }, effects));
      const missingNote = await closeOpportunity(db, pic, { opportunityId, expectedVersion: 2, outcome: "LOST_COMPETITIVE", reasonId: reason.id });
      assert.ok("error" in missingNote && missingNote.error === "Ghi chú cho lý do Khác.");
      const prep = await Promise.all(["Prep 1", "Prep 2"].map((title) => db.task.create({ data: { title, creatorId: f.pic.id, opportunityId } })));
      const done = await db.task.create({ data: { title: "Completed prep", creatorId: f.pic.id, opportunityId, status: "DONE" } });
      const closed = await closeOpportunity(db, pic, { opportunityId, expectedVersion: 2, outcome: "LOST_COMPETITIVE", reasonId: reason.id, note: "Client chose a rival", lessons: "Earlier discovery", followUp: { title: "Win back", assigneeId: f.assignee.id, dueDate: new Date("2027-01-01") } });
      assert.ok("ok" in closed && closed.cancelledTasks === 2);
      assert.equal(await db.task.count({ where: { id: { in: prep.map((task) => task.id) }, status: "CANCELLED", closedReason: "Cơ hội kết thúc: Thua cạnh tranh" } }), 2);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: done.id } })).status, "DONE");
      const followUp = await db.task.findFirstOrThrow({ where: { sourceOpportunityId: opportunityId, crmKind: "WINBACK" } });
      assert.equal(followUp.clientId, f.client.id);
      assert.equal(followUp.opportunityId, null);
      assert.equal(followUp.status, "TODO");
      const noReopen = await advanceStage(db, pic, { opportunityId, expectedVersion: 3, to: "BIDDING" }, effects);
      assert.ok("error" in noReopen && noReopen.error === "Cơ hội đã kết thúc không mở lại được.");
      assert.equal(await db.opportunityStageEvent.count({ where: { opportunityId } }), 4);
    });

    await t.test("concurrent closes produce one terminal transition", async () => {
      const opportunityId = await open();
      const reason = await db.crmReason.findFirstOrThrow({ where: { group: "CANCELLED", requiresNote: false, active: true } });
      const results = await Promise.all([1, 2].map(() => closeOpportunity(db, pic, { opportunityId, expectedVersion: 0, outcome: "CUSTOMER_CANCELLED", reasonId: reason.id })));
      assert.equal(results.filter((result) => "ok" in result).length, 1);
      assert.equal(await db.opportunityStageEvent.count({ where: { opportunityId, outcome: "CUSTOMER_CANCELLED" } }), 1);
    });

    await t.test("Brief preserves a consolidated task still serving another active event", async () => {
      const events = await Promise.all([3, 4].map((month) => db.expectedEvent.create({ data: { clientId: f.client.id, programTypeCode: "MICE", precision: "MONTH", year: 2027, month, source: "CLIENT_CONFIRMED" } })));
      const shared = await db.task.create({ data: { title: "Consolidated reminder", creatorId: f.pic.id, clientId: f.client.id, crmKind: "EVENT_REMINDER" } });
      for (const event of events) await db.reminderStep.create({ data: { expectedEventId: event.id, revision: 0, kind: "OFFSET", offsetDays: 30, dueDate: new Date("2027-02-01"), status: "OPEN", taskId: shared.id } });
      const opportunityId = await open({ expectedEventId: events[0].id });
      assert.ok("ok" in await advanceStage(db, pic, { opportunityId, expectedVersion: 0, to: "BRIEF", briefReceivedAt: new Date() }, effects));
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: shared.id } })).status, "TODO");
      assert.equal(await db.reminderStep.count({ where: { expectedEventId: events[1].id, status: "OPEN" } }), 1);
    });

    await t.test("one event cannot acquire two Opportunities and invalid follow-up cannot partially close", async () => {
      const event = await db.expectedEvent.create({ data: { clientId: f.client.id, programTypeCode: "MICE", precision: "MONTH", year: 2027, month: 5, source: "CLIENT_CONFIRMED" } });
      const results = await Promise.all([1, 2].map(() => openOpportunity(db, pic, { ...openInput, expectedEventId: event.id })));
      assert.equal(results.filter((result) => "ok" in result).length, 1);
      assert.equal(await db.opportunity.count({ where: { expectedEventId: event.id } }), 1);
      const opportunityId = await open();
      const reason = await db.crmReason.findFirstOrThrow({ where: { group: "CANCELLED", requiresNote: false, active: true } });
      await db.user.update({ where: { id: f.outsider.id }, data: { isActive: false } });
      assert.ok("error" in await closeOpportunity(db, pic, { opportunityId, expectedVersion: 0, outcome: "CUSTOMER_CANCELLED", reasonId: reason.id, followUp: { title: "Follow up", assigneeId: f.outsider.id, dueDate: new Date() } }));
      const row = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
      assert.equal(row.outcome, null);
      assert.equal(row.version, 0);
      assert.ok("error" in await closeOpportunity(db, outsider, { opportunityId, expectedVersion: 0, outcome: "CUSTOMER_CANCELLED", reasonId: reason.id }));
    });

    await t.test("foreign owners/units/events and outsiders cannot mutate the lifecycle", async () => {
      assert.ok("error" in await openOpportunity(db, outsider, openInput));
      const otherClient = await db.client.create({ data: { name: `${prefix} Foreign client` } });
      const unit = await db.buyingUnit.create({ data: { clientId: otherClient.id, name: "Other unit" } });
      const event = await db.expectedEvent.create({ data: { clientId: otherClient.id, programTypeCode: "MICE", precision: "MONTH", year: 2027, month: 3, source: "CLIENT_CONFIRMED" } });
      assert.ok("error" in await openOpportunity(db, pic, { ...openInput, buyingUnitId: unit.id }));
      assert.ok("error" in await openOpportunity(db, pic, { ...openInput, expectedEventId: event.id }));
      const opportunityId = await open();
      assert.ok("error" in await advanceStage(db, outsider, { opportunityId, expectedVersion: 0, to: "BRIEF", briefReceivedAt: new Date() }, effects));
      assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })).version, 0);
    });
  } finally {
    try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); }
  }
});
