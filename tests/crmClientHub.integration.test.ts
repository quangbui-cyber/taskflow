import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { saveClientPlaybookSection } from "../lib/crm/clientPlaybook";
import { saveProjectFeedback } from "../lib/crm/projectFeedback";
import { runCrmReminderJob } from "../lib/crm/reminderJob";
import { loadWeeklyReviewGroups } from "../lib/crm/reviewData";
import { mergeClients } from "../lib/crm/clientMerge";
import { archiveClient } from "../lib/crm/clientService";
import { loadClientProfile } from "../lib/crm/clientData";
import { loadClientHub } from "../lib/crm/clientHubData";
import { getCrmSettings } from "../lib/crm/settings";
import { addDaysVn, vnDateKey, vnDayStart } from "../lib/crm/dates";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

const STALE = /Dữ liệu vừa được người khác cập nhật/;
const DENIED = /không có quyền/;

test("crm53 client hub: playbook, project feedback, renewal reminders, merge and document visibility", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const prefix = `hub-${randomUUID()}`;
  const now = new Date("2026-11-11T09:00:00+07:00");
  const today = vnDayStart(now);
  try {
    const f = await seedCrmFixture(db, prefix);
    const actor = (user: { id: string; name: string }, role: string, accountId: string | null, managedTeamIds: string[], isDataSteward = false) => ({ id: user.id, name: user.name, role, accountId, managedTeamIds, isDataSteward });
    const admin = actor(f.admin, "ADMIN", null, []);
    const manager = actor(f.manager, "ACCOUNT", f.otherAccount.id, [f.team.id]);
    const pic = actor(f.pic, "ACCOUNT", f.picAccount.id, []);
    const user = actor(f.outsider, "USER", null, []);
    const otherAccount = actor(f.assignee, "ACCOUNT", null, []);
    const make = (suffix: string, data: Record<string, unknown> = {}) => db.client.create({ data: { name: `${prefix} ${suffix}`, picAccountId: f.picAccount.id, responsibleTeamId: f.team.id, ...data } });
    const version = async (id: string) => (await db.client.findUniqueOrThrow({ where: { id } })).version;
    const project = (clientId: string, suffix: string, data: Record<string, unknown> = {}) => db.project.create({ data: { name: `${prefix} ${suffix}`, ownerId: f.admin.id, clientId, category: "CLIENT", status: "DONE", type: "MICE", revenue: 100_000_000, onProcessAt: new Date("2026-03-01T00:00:00Z"), executionStartAt: new Date("2026-03-10T00:00:00Z"), ...data } });

    await t.test("playbook saves one section at a time with version, history and who/when", async () => {
      const c = await make("Playbook", { paymentPractice: "Trễ 10 ngày", executionNotes: "Giờ setup 6h" });
      const saved = await saveClientPlaybookSection(db, pic, { clientId: c.id, expectedVersion: 0, section: "PAYMENT", fields: { paymentTermsText: " 45 ngày sau nghiệm thu " } });
      assert.deepEqual(saved, { ok: true, version: 1, changed: 1 });
      const row = await db.client.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(row.paymentTermsText, "45 ngày sau nghiệm thu"); assert.equal(row.paymentPractice, "Trễ 10 ngày"); assert.equal(row.executionNotes, "Giờ setup 6h");
      const update = await db.clientPlaybookUpdate.findUniqueOrThrow({ where: { clientId_section: { clientId: c.id, section: "PAYMENT" } } });
      assert.equal(update.updatedById, f.pic.id);
      const log = await db.clientFieldChange.findMany({ where: { clientId: c.id } });
      assert.deepEqual(log.map((l) => [l.field, l.oldValue, l.newValue, l.actorName]), [["paymentTermsText", null, "45 ngày sau nghiệm thu", f.pic.name]]);
      // Same values again: nothing written, version unchanged.
      assert.deepEqual(await saveClientPlaybookSection(db, pic, { clientId: c.id, expectedVersion: 1, section: "PAYMENT", fields: { paymentTermsText: "45 ngày sau nghiệm thu" } }), { ok: true, version: 1, changed: 0 });
      // Stale version is refused; a field outside the section is refused.
      assert.match((await saveClientPlaybookSection(db, manager, { clientId: c.id, expectedVersion: 0, section: "PROCUREMENT", fields: { quotesRequired: 3 } }) as { error: string }).error, STALE);
      assert.ok("error" in await saveClientPlaybookSection(db, pic, { clientId: c.id, expectedVersion: 1, section: "PAYMENT", fields: { brandDos: "x" } }));
      const procurement = await saveClientPlaybookSection(db, manager, { clientId: c.id, expectedVersion: 1, section: "PROCUREMENT", fields: { vendorStatus: "REGISTERED", vendorRegisteredUntil: "2027-06-30", quotesRequired: 3 } });
      assert.ok("ok" in procurement && procurement.version === 2);
      const after = await db.client.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(vnDateKey(after.vendorRegisteredUntil!), "2027-06-30"); assert.equal(after.paymentTermsText, "45 ngày sau nghiệm thu");
      const dateLog = await db.clientFieldChange.findFirstOrThrow({ where: { clientId: c.id, field: "vendorRegisteredUntil" } });
      assert.equal(dateLog.newValue, "2027-06-30");
      assert.equal((await db.clientPlaybookUpdate.findUniqueOrThrow({ where: { clientId_section: { clientId: c.id, section: "PROCUREMENT" } } })).updatedById, f.manager.id);
      // History failure rolls back the field change.
      const faulty = db.$extends({ query: { clientFieldChange: { createMany() { throw new Error("Injected history failure"); } } } }) as unknown as typeof db;
      await assert.rejects(saveClientPlaybookSection(faulty, pic, { clientId: c.id, expectedVersion: 2, section: "EXECUTION", fields: { executionNotes: "Mới" } }), /Injected history failure/);
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: c.id } })).executionNotes, "Giờ setup 6h");
    });

    await t.test("playbook permissions: USER and unrelated ACCOUNT denied, PIC/manager/Admin allowed, Payment included", async () => {
      const c = await make("Playbook roles");
      for (const who of [user, otherAccount]) assert.match((await saveClientPlaybookSection(db, who, { clientId: c.id, expectedVersion: 0, section: "PAYMENT", fields: { invoiceNotes: "x" } }) as { error: string }).error, DENIED);
      assert.ok("ok" in await saveClientPlaybookSection(db, pic, { clientId: c.id, expectedVersion: 0, section: "PAYMENT", fields: { invoiceNotes: "PIC" } }));
      assert.ok("ok" in await saveClientPlaybookSection(db, manager, { clientId: c.id, expectedVersion: 1, section: "PAYMENT", fields: { invoiceNotes: "Manager" } }));
      assert.ok("ok" in await saveClientPlaybookSection(db, admin, { clientId: c.id, expectedVersion: 2, section: "BRAND", fields: { brandGuidelineUrl: "brand.example.vn", brandDos: "Concept an toàn" } }));
      assert.equal(await version(c.id), 3);
    });

    await t.test("project feedback: rating 1-5 on recognized Projects, EDIT or Project member, no client person stored", async () => {
      const c = await make("Feedback");
      const p = await project(c.id, "Feedback project");
      const bidding = await project(c.id, "Bidding project", { status: "BIDDING", onProcessAt: null });
      assert.match((await saveProjectFeedback(db, user, { projectId: p.id, rating: 5, caseStudy: "ALLOWED" }) as { error: string }).error, DENIED);
      await db.projectMember.create({ data: { projectId: p.id, userId: f.outsider.id } });
      assert.deepEqual(await saveProjectFeedback(db, user, { projectId: p.id, rating: 4, note: " Khách hài lòng ", caseStudy: "NOT_ASKED" }), { ok: true });
      assert.deepEqual(await saveProjectFeedback(db, pic, { projectId: p.id, rating: 5, note: null, caseStudy: "ALLOWED" }), { ok: true });
      for (const bad of [{ rating: 0 }, { rating: 6 }, { rating: 4.5 }, { caseStudy: "MAYBE" }, { note: "x".repeat(1001) }]) assert.ok("error" in await saveProjectFeedback(db, pic, { projectId: p.id, rating: 4, caseStudy: "ALLOWED", ...bad } as never));
      assert.ok("error" in await saveProjectFeedback(db, pic, { projectId: bidding.id, rating: 4, caseStudy: "ALLOWED" }));
      const rows = await db.projectFeedback.findMany({ where: { projectId: p.id } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].rating, 5); assert.equal(rows[0].note, null); assert.equal(rows[0].caseStudy, "ALLOWED"); assert.equal(rows[0].createdById, f.outsider.id);
      assert.deepEqual(Object.keys(rows[0]).sort(), ["caseStudy", "createdAt", "createdById", "id", "note", "projectId", "rating", "updatedAt"]);
      await assert.rejects(db.projectFeedback.update({ where: { id: rows[0].id }, data: { rating: 7 } }), /check/i);
    });

    await t.test("renewal reminder 30 days ahead, idempotent per term, skips archived clients, shows in Review", async () => {
      const c = await make("Renewal", { vendorStatus: "REGISTERED", vendorRegisteredUntil: addDaysVn(today, 20), frameworkContractUntil: addDaysVn(today, 45), createdAt: today });
      const archived = await make("Renewal archived", { vendorStatus: "REGISTERED", vendorRegisteredUntil: addDaysVn(today, 10), createdAt: today });
      assert.ok("ok" in await archiveClient(db, manager, { clientId: archived.id, expectedVersion: 0, reason: "Tạm dừng" }));
      const ids = [c.id, archived.id];
      const scoped = db.$extends({ query: {
        client: { findMany({ args, query }) { return query({ ...args, where: { AND: [args.where ?? {}, { id: { in: ids } }] } }); } },
        meeting: { findMany() { return Promise.resolve([]); } },
      } }) as unknown as typeof db;
      const first = await runCrmReminderJob(scoped, { now });
      assert.equal(first.renewalTasks, 1);
      const renewal = first.notifications.filter((n) => n.dedupeKey.startsWith("crm:renewal:"));
      assert.equal(renewal.length, 1); assert.equal(renewal[0].userId, f.pic.id); assert.equal(renewal[0].clientId, c.id);
      const second = await runCrmReminderJob(scoped, { now: new Date(now.getTime() + 3600000) });
      assert.equal(second.renewalTasks, 0);
      assert.equal(second.notifications.filter((n) => n.dedupeKey.startsWith("crm:renewal:")).length, 0);
      const tasks = await db.task.findMany({ where: { clientId: { in: ids }, crmKind: "RENEWAL" } });
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].clientId, c.id); assert.equal(tasks[0].assigneeId, f.pic.id); assert.equal(tasks[0].dueDate?.getTime(), today.getTime());
      assert.match(tasks[0].title, /^Gia hạn đăng ký NCC với .* trước \d{2}\/\d{2}\/2026$/);
      assert.equal(await db.cadenceReminder.count({ where: { clientId: c.id, periodKey: `renewal:vendor:${vnDateKey(addDaysVn(today, 20))}` } }), 1);
      // Framework contract enters the 30-day window 15 days later; a renewed registration date is a new term.
      const later = new Date(now.getTime() + 15 * 86400000);
      assert.equal((await runCrmReminderJob(scoped, { now: later })).renewalTasks, 1);
      await db.client.update({ where: { id: c.id }, data: { vendorRegisteredUntil: addDaysVn(today, 40) } });
      assert.equal((await runCrmReminderJob(scoped, { now: later })).renewalTasks, 1);
      assert.equal(await db.task.count({ where: { clientId: c.id, crmKind: "RENEWAL" } }), 3);
      assert.equal(await db.task.count({ where: { clientId: archived.id } }), 0);
      const review = Object.values((await loadWeeklyReviewGroups(db, admin, { team: "all", pic: "all" }, now)).groups).flat();
      assert.ok(review.some((row) => row.client.id === c.id && row.reason.sentence.startsWith("Gia hạn")));
    });

    await t.test("merge keeps target playbook values, fills empty ones and logs them", async () => {
      const target = await make("Merge target", { paymentTermsText: "30 ngày", quotesRequired: null });
      const source = await make("Merge source", { paymentTermsText: "60 ngày", quotesRequired: 3, brandDos: "Concept", vendorRegisteredUntil: new Date("2027-06-29T17:00:00Z") });
      await db.clientPlaybookUpdate.createMany({ data: [{ clientId: target.id, section: "PAYMENT", updatedById: f.manager.id }, { clientId: source.id, section: "PAYMENT", updatedById: f.pic.id }, { clientId: source.id, section: "BRAND", updatedById: f.pic.id }] });
      const steward = actor(f.admin, "ADMIN", null, [], true);
      const result = await mergeClients(db, steward, { sourceClientId: source.id, targetClientId: target.id, expectedSourceVersion: 0, expectedTargetVersion: 0 });
      assert.ok("ok" in result);
      assert.equal(result.movedCounts.playbookFields, 3); assert.equal(result.movedCounts.playbookSections, 1);
      const row = await db.client.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(row.paymentTermsText, "30 ngày"); assert.equal(row.quotesRequired, 3); assert.equal(row.brandDos, "Concept"); assert.equal(vnDateKey(row.vendorRegisteredUntil!), "2027-06-30");
      const sections = await db.clientPlaybookUpdate.findMany({ where: { clientId: target.id }, orderBy: { section: "asc" } });
      assert.deepEqual(sections.map((s) => [s.section, s.updatedById]), [["BRAND", f.pic.id], ["PAYMENT", f.manager.id]]);
      const log = await db.clientFieldChange.findMany({ where: { clientId: target.id, field: { in: ["quotesRequired", "brandDos", "vendorRegisteredUntil", "paymentTermsText"] } }, orderBy: { field: "asc" } });
      assert.deepEqual(log.map((l) => [l.field, l.newValue, l.actorName]), [["brandDos", "Concept", f.admin.name], ["quotesRequired", 3, f.admin.name], ["vendorRegisteredUntil", "2027-06-30", f.admin.name]]);
    });

    await t.test("hub loader: batched queries, recognized Projects only, Project files hidden without access", async () => {
      const c = await make("Docs");
      const opp = await db.opportunity.create({ data: { name: `${prefix} Docs opp`, clientId: c.id, stage: "BRIEF", programTypeCode: "MICE", expectedYear: 2027, expectedMonth: 3, demandSignal: "test", source: "OTHER", picAccountId: f.picAccount.id, winStrategy: "Concept" } });
      const p1 = await project(c.id, "Docs project");
      await project(c.id, "Docs project 2", { revenue: 50_000_000, onProcessAt: new Date("2025-12-01T00:00:00Z"), executionStartAt: null });
      await project(c.id, "Docs bidding", { status: "BIDDING", onProcessAt: null });
      await db.projectFile.create({ data: { projectId: p1.id, name: "secret-project.pdf", mimeType: "application/pdf", size: 1, data: Buffer.from("x") } });
      await db.projectFile.create({ data: { opportunityId: opp.id, name: "proposal.pdf", mimeType: "application/pdf", size: 1, data: Buffer.from("x") } });
      await db.projectFile.create({ data: { clientId: c.id, name: "guideline.pdf", mimeType: "application/pdf", size: 1, data: Buffer.from("x") } });
      const settings = await getCrmSettings(db);
      let operations = 0;
      const counted = db.$extends({ query: { $allModels: { $allOperations({ args, query }) { operations++; return query(args); } } } }) as unknown as typeof db;
      const profile = (await loadClientProfile(db, c.id, settings, now))!;
      const load = async (viewer: { id: string; role: string }) => { operations = 0; const hub = await loadClientHub(counted, profile, viewer, { MICE: "MICE" }, now, { showRevenue: viewer.role !== "USER" }); return { hub, operations }; };
      const outsider = await load({ id: f.outsider.id, role: "USER" });
      const names = (hub: Awaited<ReturnType<typeof load>>["hub"]) => hub.documents.flatMap((group) => group.items.map((item) => item.name)).sort();
      assert.deepEqual(names(outsider.hub), ["guideline.pdf", "proposal.pdf"]);
      assert.ok(outsider.operations <= 6, `queries: ${outsider.operations}`);
      assert.equal(outsider.hub.projectRows.length, 2);
      assert.ok(outsider.hub.projectRows.every((row) => row.revenue === null));
      assert.deepEqual(names((await load({ id: f.admin.id, role: "ADMIN" })).hub), ["guideline.pdf", "proposal.pdf", "secret-project.pdf"]);
      await db.projectMember.create({ data: { projectId: p1.id, userId: f.outsider.id } });
      const member = await load({ id: f.outsider.id, role: "USER" });
      assert.deepEqual(names(member.hub), ["guideline.pdf", "proposal.pdf", "secret-project.pdf"]);
      assert.equal(member.operations, outsider.operations);
      assert.equal(member.hub.projectRows.find((row) => row.id === p1.id)!.isMember, true);
      assert.deepEqual(member.hub.grid.points.map((p) => [p.kind, p.year, p.month]), [["PROJECT", 2025, 12], ["PROJECT", 2026, 3], ["OPPORTUNITY", 2027, 3]]);
      assert.deepEqual(member.hub.bids.items.map((i) => i.id), [opp.id]);
      assert.equal(member.hub.playbook.emptyCount, 4);
      assert.equal(member.hub.upcoming?.kind, "OPPORTUNITY");
    });
  } finally {
    await db.projectFile.deleteMany({ where: { OR: [{ name: { in: ["secret-project.pdf", "proposal.pdf", "guideline.pdf"] }, client: { name: { startsWith: `${prefix} ` } } }, { opportunity: { client: { name: { startsWith: `${prefix} ` } } } }] } });
    await cleanupCrmFixture(db, prefix);
    await db.$disconnect();
  }
});
