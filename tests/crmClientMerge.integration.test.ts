import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { clientHasCrmData, listDuplicateClientPairs, mergeClients } from "../lib/crm/clientMerge";
import { KPI_RECOGNIZED_STATUSES } from "../lib/kpi";
import { crmTestDatabaseUrl, createCrmTestDb, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";

test("client merge preserves all owners, collisions, fields, audit and recognized revenue", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb(); const prefix = `merge-${randomUUID()}`;
  const folderIds: string[] = []; const runIds: string[] = [];
  try {
    const f = await seedCrmFixture(db, prefix);
    const actor = { id: f.admin.id, name: f.admin.name, role: "ADMIN", accountId: null, managedTeamIds: [], isDataSteward: false };
    const source = await db.client.update({ where: { id: f.client.id }, data: { name: `${prefix} Company`, industry: "Source", picAccountId: f.picAccount.id, responsibleTeamId: f.team.id, potentialLevel: "HIGH", potentialScoredById: f.admin.id, potentialScoredAt: new Date("2026-01-01"), budgetSeason: "Q4", budgetSeasonMonth: 9, vendorSelection: "Tender", valuedMost: "Ideas", importStatus: "CONFIRMED", importConfirmedAt: new Date("2026-01-02") } });
    const target = await db.client.create({ data: { name: `${prefix} Co., Ltd`, industry: "Target", createdAt: new Date("2025-01-01") } });
    const input = { sourceClientId: source.id, targetClientId: target.id, expectedSourceVersion: source.version, expectedTargetVersion: target.version };
    const [unitA, unitB, uniqueUnit] = await Promise.all([
      db.buyingUnit.create({ data: { clientId: source.id, name: "HR" } }), db.buyingUnit.create({ data: { clientId: target.id, name: "HR" } }), db.buyingUnit.create({ data: { clientId: source.id, name: "Marketing" } }),
    ]);
    await db.opportunity.update({ where: { id: f.opportunity.id }, data: { buyingUnitId: unitA.id, budgetMax: 999999999 } });
    const project = await db.project.create({ data: { name: `${prefix} Project`, ownerId: f.admin.id, clientId: source.id, accountId: f.picAccount.id, category: "CLIENT", status: "ON_PROCESS", revenue: 123456, onProcessAt: new Date("2026-11-01") } });
    const event = await db.expectedEvent.create({ data: { clientId: source.id, buyingUnitId: unitA.id, programTypeCode: "MICE", precision: "MONTH", year: 2026, month: 11, source: "OTHER" } });
    const task = await db.task.create({ data: { title: `${prefix} Task`, clientId: source.id, creatorId: f.admin.id } });
    const file = await db.projectFile.create({ data: { name: `${prefix}.txt`, clientId: source.id, mimeType: "text/plain", size: 1, data: Buffer.from("x"), driveFileId: `${prefix}-file` } });
    const meeting = await db.meeting.create({ data: { title: `${prefix} Meeting`, clientId: source.id, organizerId: f.admin.id, startAt: new Date("2026-11-01"), endAt: new Date("2026-11-02") } });
    const score = await db.clientPotentialScore.create({ data: { clientId: source.id, level: "HIGH", scoredByName: f.admin.name } });
    const notice = await db.notification.create({ data: { userId: f.admin.id, clientId: source.id, message: "Synthetic", type: "CRM_DRAFT" } });
    const point = await db.touchpoint.create({ data: { clientId: source.id, kind: "MEETING", occurredAt: new Date(), status: "CONFIRMED", outcomeLevel: 2 } });
    const collisions: { from: { id: string }; to: { id: string }; keep: string }[] = [];
    for (const [key, fromStatus, toStatus] of [["target", "DRAFT", "CONFIRMED"], ["source", "CONFIRMED", "DISMISSED"], ["tie", "DRAFT", "DRAFT"]]) {
      const from = await db.touchpoint.create({ data: { clientId: source.id, kind: "MEETING", occurredAt: new Date(), sourceType: "MEETING", sourceId: `${prefix}-${key}`, status: fromStatus, outcomeLevel: fromStatus === "CONFIRMED" ? 2 : null } });
      const to = await db.touchpoint.create({ data: { clientId: target.id, kind: "MEETING", occurredAt: new Date(), sourceType: "MEETING", sourceId: `${prefix}-${key}`, status: toStatus, outcomeLevel: toStatus === "CONFIRMED" ? 2 : null } });
      collisions.push({ from, to, keep: key === "source" ? from.id : to.id });
    }
    await db.cadenceReminder.createMany({ data: [{ clientId: source.id, periodKey: "P", taskId: task.id }, { clientId: target.id, periodKey: "P" }, { clientId: source.id, periodKey: "Q" }] });
    const run = await db.trackerImportRun.create({ data: { mode: "DRY_RUN", actorName: f.admin.name, fileName: "synthetic.xlsx" } }); runIds.push(run.id);
    const tracker = await db.trackerImportRow.create({ data: { runId: run.id, sheet: "Prospect", rowNumber: 2, raw: {}, proposed: {}, status: "OK", matchedClientId: source.id } });
    for (const suffix of ["", ":tasks"]) { const id = `${prefix}-folder${suffix}`; folderIds.push(id); await db.driveFolder.create({ data: { key: `client:${source.id}${suffix}`, folderId: id, name: "Synthetic" } }); }
    const recognized = () => db.project.groupBy({ by: ["accountId"], where: { id: project.id, category: "CLIENT", status: { in: KPI_RECOGNIZED_STATUSES } }, _sum: { revenue: true } });
    const before = await recognized();
    await t.test("manager is refused; stale, missing and self merge do not mutate", async () => {
      assert.ok("error" in await mergeClients(db, { ...actor, role: "ACCOUNT", id: f.manager.id, managedTeamIds: [f.team.id] }, input));
      assert.deepEqual(await mergeClients(db, actor, { ...input, sourceClientId: target.id }), { error: "Chọn hai khách khác nhau." });
      assert.match((await mergeClients(db, actor, { ...input, expectedTargetVersion: 9 }) as { error: string }).error, /Dữ liệu vừa/);
      assert.deepEqual(await mergeClients(db, actor, { ...input, targetClientId: "missing" }), { error: "Không tìm thấy khách." });
      assert.equal(await db.clientMergeLog.count({ where: { sourceClientId: source.id } }), 0);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).clientId, source.id);
    });
    await t.test("duplicate list is enriched in batches and suggests more established business", async () => {
      const pair = (await listDuplicateClientPairs(db)).find((p) => [p.a.id, p.b.id].includes(source.id) && [p.a.id, p.b.id].includes(target.id));
      assert.ok(pair); assert.equal(pair.suggestedTargetId, source.id);
      const side = pair.a.id === source.id ? pair.a : pair.b;
      assert.equal(side.projectCount, 1); assert.equal(side.opportunityCount, 1); assert.equal(side.openTaskCount, 1); assert.equal(side.touchpointCount, 4);
    });
    await t.test("failure late in the transaction restores moved rows and deleted collisions", async () => {
      const faultDb = db.$extends({ query: { clientMergeLog: { create() { throw new Error("Injected audit failure"); } } } }) as unknown as typeof db;
      await assert.rejects(mergeClients(faultDb, actor, input), /Injected audit failure/);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).clientId, source.id);
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: target.id } })).version, 0);
      assert.equal(await db.touchpoint.count({ where: { clientId: source.id } }), 4);
      assert.ok(await db.buyingUnit.findUnique({ where: { id: unitA.id } }));
    });
    await t.test("admin atomically moves every relation and handles conflicts without losing ownership", async () => {
      const result = await mergeClients(db, actor, input); assert.ok("ok" in result);
      assert.deepEqual(result.movedCounts, { projects: 1, opportunities: 1, expectedEvents: 1, buyingUnitsMoved: 1, buyingUnitsMerged: 1, touchpoints: 2, touchpointCollisions: 3, tasks: 1, files: 1, meetings: 1, potentialScores: 1, cadenceMoved: 1, cadenceDropped: 1, trackerRows: 1, notifications: 1, driveFoldersRekeyed: true });
      assert.equal(await db.client.findUnique({ where: { id: source.id } }), null);
      for (const moved of [await db.project.findUniqueOrThrow({ where: { id: project.id } }), await db.opportunity.findUniqueOrThrow({ where: { id: f.opportunity.id } }), await db.expectedEvent.findUniqueOrThrow({ where: { id: event.id } }), await db.task.findUniqueOrThrow({ where: { id: task.id } }), await db.projectFile.findUniqueOrThrow({ where: { id: file.id } }), await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } }), await db.clientPotentialScore.findUniqueOrThrow({ where: { id: score.id } }), await db.notification.findUniqueOrThrow({ where: { id: notice.id } })]) assert.equal(moved.clientId, target.id);
      assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: f.opportunity.id } })).buyingUnitId, unitB.id);
      assert.equal((await db.expectedEvent.findUniqueOrThrow({ where: { id: event.id } })).buyingUnitId, unitB.id);
      assert.equal((await db.buyingUnit.findUniqueOrThrow({ where: { id: uniqueUnit.id } })).clientId, target.id);
      assert.equal(await db.buyingUnit.count({ where: { clientId: target.id, name: "HR" } }), 1);
      for (const collision of collisions) { assert.ok(await db.touchpoint.findUnique({ where: { id: collision.keep } })); assert.equal(await db.touchpoint.findUnique({ where: { id: collision.keep === collision.from.id ? collision.to.id : collision.from.id } }), null); }
      assert.equal((await db.touchpoint.findUniqueOrThrow({ where: { id: point.id } })).clientId, target.id);
      assert.equal(await db.cadenceReminder.count({ where: { clientId: target.id, periodKey: "P" } }), 1);
      assert.equal((await db.trackerImportRow.findUniqueOrThrow({ where: { id: tracker.id } })).matchedClientId, target.id);
      const kept = await db.client.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(kept.version, 1); assert.equal(kept.industry, "Target"); assert.equal(kept.picAccountId, source.picAccountId); assert.equal(kept.potentialLevel, "HIGH"); assert.equal(kept.potentialScoredById, source.potentialScoredById); assert.deepEqual(kept.potentialScoredAt, source.potentialScoredAt); assert.equal(kept.importStatus, source.importStatus); assert.deepEqual(kept.importConfirmedAt, source.importConfirmedAt); assert.equal(kept.budgetSeasonMonth, 9);
      const log = await db.clientMergeLog.findFirstOrThrow({ where: { sourceClientId: source.id } });
      assert.equal(log.sourceClientName, source.name); assert.equal(log.actorName, actor.name); assert.equal((log.movedCounts as { tasks: number }).tasks, 1);
      const owners = await db.$queryRaw<{ n: number }[]>`SELECT num_nonnulls("projectId", "opportunityId", "clientId") AS n FROM "Task" WHERE id = ${task.id} UNION ALL SELECT num_nonnulls("projectId", "opportunityId", "clientId") AS n FROM "ProjectFile" WHERE id = ${file.id} UNION ALL SELECT num_nonnulls("projectId", "opportunityId", "clientId") AS n FROM "Meeting" WHERE id = ${meeting.id}`;
      assert.ok(owners.every((o) => o.n === 1)); assert.deepEqual(await recognized(), before);
      assert.equal((await db.projectFile.findUniqueOrThrow({ where: { id: file.id } })).driveFileId, `${prefix}-file`);
      assert.equal(await db.driveFolder.count({ where: { key: { in: [`client:${target.id}`, `client:${target.id}:tasks`] } } }), 2);
    });
    await t.test("non-admin data steward can merge; target Drive folders and metadata stay authoritative", async () => {
      const a = await db.client.create({ data: { name: `${prefix} Steward A`, potentialLevel: "LOW" } });
      const b = await db.client.create({ data: { name: `${prefix} Steward B`, potentialLevel: "HIGH", potentialScoredById: f.admin.id, importStatus: "PENDING_CONFIRMATION" } });
      const steward = await db.user.update({ where: { id: f.outsider.id }, data: { isCrmDataSteward: true } });
      for (const c of [a, b]) { const id = `${prefix}-${c.id}`; folderIds.push(id); await db.driveFolder.create({ data: { key: `client:${c.id}`, folderId: id, name: "Synthetic" } }); }
      const result = await mergeClients(db, { ...actor, id: steward.id, name: steward.name, role: steward.role, isDataSteward: steward.isCrmDataSteward }, { sourceClientId: a.id, targetClientId: b.id, expectedSourceVersion: 0, expectedTargetVersion: 0 });
      assert.ok("ok" in result); assert.equal(result.movedCounts.driveFoldersRekeyed, false);
      assert.ok(await db.driveFolder.findUnique({ where: { key: `client:${a.id}` } }));
      const kept = await db.client.findUniqueOrThrow({ where: { id: b.id } }); assert.equal(kept.potentialLevel, "HIGH"); assert.equal(kept.potentialScoredById, f.admin.id); assert.equal(kept.importStatus, "PENDING_CONFIRMATION"); assert.equal(kept.importConfirmedAt, null);
      assert.equal((await db.clientMergeLog.findFirstOrThrow({ where: { sourceClientId: a.id } })).actorName, steward.name);
    });
    await t.test("opposing concurrent merges produce exactly one audited survivor", async () => {
      const a = await db.client.create({ data: { name: `${prefix} Race A` } }); const b = await db.client.create({ data: { name: `${prefix} Race B` } });
      const results = await Promise.all([[a, b], [b, a]].map(([source, target]) => mergeClients(db, actor, { sourceClientId: source.id, targetClientId: target.id, expectedSourceVersion: 0, expectedTargetVersion: 0 })));
      assert.equal(results.filter((r) => "ok" in r).length, 1); assert.equal(results.filter((r) => "error" in r).length, 1);
      assert.equal(await db.client.count({ where: { id: { in: [a.id, b.id] } } }), 1);
      assert.equal(await db.clientMergeLog.count({ where: { sourceClientId: { in: [a.id, b.id] } } }), 1);
    });
    await t.test("CRM data guard distinguishes a bare catalog client", async () => {
      const bare = await db.client.create({ data: { name: `${prefix} Bare` } });
      assert.equal(await clientHasCrmData(db, bare.id), false); assert.equal(await clientHasCrmData(db, target.id), true);
      await db.client.update({ where: { id: bare.id }, data: { picAccountId: f.picAccount.id } }); assert.equal(await clientHasCrmData(db, bare.id), true);
    });
  } finally {
    await db.driveFolder.deleteMany({ where: { folderId: { in: folderIds } } });
    await db.trackerImportRun.deleteMany({ where: { id: { in: runIds } } });
    await db.clientMergeLog.deleteMany({ where: { sourceClientName: { startsWith: `${prefix} ` } } });
    await cleanupCrmFixture(db, prefix); await db.$disconnect();
  }
});
