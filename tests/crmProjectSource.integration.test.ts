import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { listPurchaseOrderSourceOpportunities, linkPurchaseOrderProjectTx } from "../lib/crm/purchaseOrderLink";
import { legacyProjectRedirectHref } from "../lib/crm/legacyRedirect";
import { parseVnDateKey } from "../lib/crm/opportunityInput";
import { crmTestDatabaseUrl, createCrmTestDb, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";

test("PO sources enforce assignment before the limit and exclude non-Bidding and closed deals", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = `posource-${randomUUID()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    const actor = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
    const base = { clientId: f.client.id, programTypeCode: "MICE", expectedYear: 2026, demandSignal: "test", source: "OTHER" };
    await db.opportunity.createMany({ data: [
      { ...base, name: `${prefix} Care`, stage: "CARE", picAccountId: f.picAccount.id },
      { ...base, name: `${prefix} Won`, stage: "BIDDING", outcome: "WON", picAccountId: f.picAccount.id },
      { ...base, name: `${prefix} Other`, stage: "BIDDING", picAccountId: f.otherAccount.id },
    ] });
    const sources = await listPurchaseOrderSourceOpportunities(db, actor);
    assert.deepEqual(sources.filter((row) => row.clientId === f.client.id), [{ id: f.opportunity.id, name: f.opportunity.name, clientId: f.client.id, clientName: f.client.name, programTypeCode: "MICE" }]);
    assert.equal((await listPurchaseOrderSourceOpportunities(db, { ...actor, id: f.outsider.id, accountId: null })).filter((row) => row.clientId === f.client.id).length, 0);
    assert.equal((await listPurchaseOrderSourceOpportunities(db, { ...actor, id: f.manager.id, managedTeamIds: [f.team.id] })).filter((row) => row.clientId === f.client.id).length, 2);
  } finally { await cleanupCrmFixture(db, prefix); await db.$disconnect(); }
});

test("PO link atomically wins at the VN PO date and moves work, members and reminders without adding budgets", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = `polink-${randomUUID()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    const actor = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { budgetMax: 9_000_000_000, opportunityMembers: { create: { userId: f.manager.id } } } });
    const tasks = await Promise.all([db.task.create({ data: { title: `${prefix} Work`, creatorId: f.admin.id, assigneeId: f.assignee.id, opportunityId: f.opportunity.id, followers: { create: { userId: f.outsider.id } } } }), db.task.create({ data: { title: `${prefix} Work2`, creatorId: f.pic.id, opportunityId: f.opportunity.id } })]);
    const clientTask = await db.task.create({ data: { title: `${prefix} Care`, creatorId: f.pic.id, clientId: f.client.id } });
    const file = await db.projectFile.create({ data: { name: `${prefix}.txt`, mimeType: "text/plain", size: 1, data: Buffer.from("x"), opportunityId: f.opportunity.id, uploaderId: f.pic.id } });
    const meeting = await db.meeting.create({ data: { title: `${prefix} Meeting`, organizerId: f.pic.id, opportunityId: f.opportunity.id, startAt: new Date("2026-10-14T01:00Z"), endAt: new Date("2026-10-14T02:00Z") } });
    const wonAt = parseVnDateKey("2026-10-15")!; const now = new Date("2026-11-09T10:00Z");
    const event = await db.expectedEvent.create({ data: { clientId: f.client.id, programTypeCode: "MICE", precision: "MONTH", year: 2026, month: 10, source: "OTHER", opportunity: { connect: { id: f.opportunity.id } }, expectedEventSteps: { create: [{ revision: 0, kind: "BRIEF", dueDate: wonAt, status: "OPEN" }, { revision: 0, kind: "CARE", dueDate: wonAt, status: "PLANNED" }] } } });
    const project = await db.project.create({ data: { name: `${prefix} Project`, ownerId: f.admin.id, clientId: f.client.id, category: "CLIENT", status: "ON_PROCESS", revenue: 150_000_000, members: { create: { userId: f.admin.id, role: "owner" } } } });
    const input = { opportunityId: f.opportunity.id, projectId: project.id, contractValue: 150_000_000, purchaseOrderNumber: "PO-TEST-1", wonAt, now };
    assert.deepEqual(await db.$transaction((tx) => linkPurchaseOrderProjectTx(tx, actor, input)), { ok: true, moved: { tasks: 2, files: 1, meetings: 1 } });
    const saved = await db.project.findUniqueOrThrow({ where: { id: project.id }, include: { members: true } });
    assert.equal(saved.sourceOpportunityId, f.opportunity.id); assert.equal(saved.onProcessAt?.toISOString(), "2026-10-14T17:00:00.000Z"); assert.equal(saved.revenue, 150_000_000);
    assert.deepEqual(saved.members.map((m) => m.userId).sort(), [f.admin.id, f.pic.id, f.manager.id, f.assignee.id, f.outsider.id].sort());
    assert.equal(saved.members.find((m) => m.userId === f.admin.id)?.role, "owner");
    for (const moved of [...await db.task.findMany({ where: { id: { in: tasks.map((t) => t.id) } } }), await db.projectFile.findUniqueOrThrow({ where: { id: file.id } }), await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } })]) {
      assert.equal(moved.projectId, project.id); assert.equal(moved.sourceOpportunityId, f.opportunity.id); assert.equal(moved.opportunityId, null);
    }
    assert.deepEqual(await db.task.findUniqueOrThrow({ where: { id: clientTask.id } }), clientTask);
    const closed = await db.opportunity.findUniqueOrThrow({ where: { id: f.opportunity.id } });
    assert.equal(closed.outcome, "WON"); assert.equal(closed.version, 1); assert.equal(Number(closed.contractValue), 150_000_000); assert.equal(closed.wonAt?.toISOString(), wonAt.toISOString()); assert.equal(closed.closedAt?.toISOString(), now.toISOString()); assert.equal(closed.closedById, actor.id);
    const stages = await db.opportunityStageEvent.findMany({ where: { opportunityId: f.opportunity.id } });
    assert.equal(stages.length, 1); assert.equal(stages[0].fromStage, "BIDDING"); assert.equal(stages[0].toStage, "WON"); assert.equal(stages[0].outcome, "WON"); assert.equal(stages[0].note, "PO PO-TEST-1"); assert.equal(stages[0].actorName, actor.name);
    assert.ok((await db.reminderStep.findMany({ where: { expectedEventId: event.id } })).every((s) => s.status === "CLOSED" && s.closedReason === "OPPORTUNITY_WON"));
    const second = await db.project.create({ data: { name: `${prefix} Second`, ownerId: f.pic.id, clientId: f.client.id, category: "CLIENT", status: "ON_PROCESS" } });
    assert.deepEqual(await db.$transaction((tx) => linkPurchaseOrderProjectTx(tx, actor, { ...input, projectId: second.id })), { error: "Cơ hội đã kết thúc không mở lại được." });
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: second.id } })).sourceOpportunityId, null);
  } finally { await cleanupCrmFixture(db, prefix); await db.$disconnect(); }
});

test("invalid PO links write nothing, and legacy project ids resolve only their Opportunity", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = `poreject-${randomUUID()}`;
  try {
    const f = await seedCrmFixture(db, prefix);
    const actor = { id: f.pic.id, name: f.pic.name, role: f.pic.role, accountId: f.picAccount.id, managedTeamIds: [], isDataSteward: false };
    const project = await db.project.create({ data: { name: `${prefix} Project`, ownerId: f.pic.id, clientId: f.client.id, category: "CLIENT", status: "ON_PROCESS" } });
    const input = { opportunityId: f.opportunity.id, projectId: project.id, contractValue: 150_000_000, purchaseOrderNumber: "PO-TEST-1", wonAt: parseVnDateKey("2026-10-15")!, now: new Date("2026-11-09T10:00Z") };
    const snapshot = async () => ({ project: await db.project.findUnique({ where: { id: project.id } }), opportunity: await db.opportunity.findUnique({ where: { id: f.opportunity.id } }), members: await db.projectMember.findMany({ where: { projectId: project.id } }), events: await db.opportunityStageEvent.findMany({ where: { opportunityId: f.opportunity.id } }) });
    for (const contractValue of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const before = await snapshot(); assert.deepEqual(await db.$transaction((tx) => linkPurchaseOrderProjectTx(tx, actor, { ...input, contractValue })), { error: "Nhập giá trị hợp đồng." }); assert.deepEqual(await snapshot(), before);
    }
    for (const wonAt of [parseVnDateKey("2026-11-10")!, new Date(NaN)]) {
      const before = await snapshot(); assert.deepEqual(await db.$transaction((tx) => linkPurchaseOrderProjectTx(tx, actor, { ...input, wonAt })), { error: "Ngày PO không được sau hôm nay." }); assert.deepEqual(await snapshot(), before);
    }
    let before = await snapshot();
    assert.deepEqual(await db.$transaction((tx) => linkPurchaseOrderProjectTx(tx, { ...actor, id: f.outsider.id, accountId: null }, input)), { error: "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team." }); assert.deepEqual(await snapshot(), before);
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { stage: "CARE" } }); before = await snapshot();
    assert.deepEqual(await db.$transaction((tx) => linkPurchaseOrderProjectTx(tx, actor, input)), { error: "Chỉ gắn được Cơ hội đang ở Bidding." }); assert.deepEqual(await snapshot(), before);
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { stage: "BIDDING", legacyProjectId: "crmtest_legacy_p1" } });
    await db.project.update({ where: { id: project.id }, data: { clientId: null } }); before = await snapshot();
    assert.deepEqual(await db.$transaction((tx) => linkPurchaseOrderProjectTx(tx, actor, input)), { error: "Cơ hội không thuộc khách của dự án." }); assert.deepEqual(await snapshot(), before);
    assert.equal(await legacyProjectRedirectHref(db, "crmtest_legacy_p1"), `/crm/opportunities/${f.opportunity.id}`);
    assert.equal(await legacyProjectRedirectHref(db, "crmtest_unknown"), null);
  } finally { await cleanupCrmFixture(db, prefix); await db.$disconnect(); }
});
