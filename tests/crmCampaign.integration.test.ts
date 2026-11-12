import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadCrmActorFrom } from "../lib/crm/actor";
import { changeCampaignStatus, deleteCampaignDraft, launchCampaign, saveCampaignDraft } from "../lib/crm/campaignService";
import { loadCampaignDetail, loadCampaignList, previewCampaign } from "../lib/crm/campaignData";
import { CAMPAIGN_CANCELLED, CAMPAIGN_MERGED_DUPLICATE, CAMPAIGN_STOPPED_OPPORTUNITY, DEFAULT_CAMPAIGN_OPTIONS, EMPTY_CAMPAIGN_FILTER, validateCampaignDraft } from "../lib/crm/campaignPlan";
import { changeClientPicOrTeam } from "../lib/crm/clientService";
import { mergeClients } from "../lib/crm/clientMerge";
import { addDaysVn, vnDateKey, vnDayStart } from "../lib/crm/dates";
import { openOpportunity } from "../lib/crm/opportunityWorkflow";
import { runCrmReminderJob } from "../lib/crm/reminderJob";
import { loadWeeklyReviewGroups } from "../lib/crm/reviewData";
import { logTouchpoint } from "../lib/crm/touchpoints";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

const KEY = "access.users";
const steps = [{ offsetDays: 0, title: "Gửi email gợi ý concept YEP", kind: "MESSAGE" }, { offsetDays: 3, title: "Gọi hỏi kế hoạch YEP", kind: "CALL" }];

test("crm52 care campaigns: launch twice, auto-stop, cadence pause, permissions, PIC change, merge, pause and cancel", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const prefix = `camp-${randomUUID()}`;
  const previousFlag = process.env.CRM_ENABLED;
  // access.users is one shared row; keep the exact original (or its absence) and put it back afterwards.
  const original = await db.crmSetting.findUnique({ where: { key: KEY } });
  const now = new Date();
  const today = vnDayStart(now);
  const startKey = vnDateKey(now);
  let f!: Awaited<ReturnType<typeof seedCrmFixture>>;
  try {
    f = await seedCrmFixture(db, prefix);
    process.env.CRM_ENABLED = "true";
    const listed = [...new Set([...(Array.isArray(original?.value) ? original.value as string[] : []), f.pic.id, f.manager.id])];
    await db.crmSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: listed, version: 1 }, update: { value: listed } });
    const actor = async (user: { id: string; role: string; name: string }) => ({ ...(await loadCrmActorFrom(db, user)), name: user.name });
    const [admin, manager, pic, userActor] = await Promise.all([actor(f.admin), actor(f.manager), actor(f.pic), actor(f.assignee)]);
    const outsiderAccount = await db.account.create({ data: { name: `${prefix} Outsider PIC`, userId: f.outsider.id, teamId: f.team.id } });
    const client = (name: string, picAccountId: string | null, extra: Record<string, unknown> = {}) => db.client.create({ data: { name: `${prefix} ${name}`, picAccountId, responsibleTeamId: picAccountId ? f.team.id : null, ...extra } });
    const A = await client("A", f.picAccount.id);
    const B = await client("B", f.otherAccount.id);
    const CAD = await client("Cadence", f.picAccount.id, { createdAt: addDaysVn(today, -200) });
    const EV = await client("Event", f.picAccount.id);
    const OUT = await client("Outsider", outsiderAccount.id);
    const ARCH = await client("Archived", f.picAccount.id, { archivedAt: now });
    const NOTEAM = await client("No team", null);
    await db.client.update({ where: { id: f.client.id }, data: { picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
    const notices: { ids: string[]; message: string }[] = [];
    const effects = { notify: async (ids: string[], data: { message: string }) => { notices.push({ ids, message: data.message }); } };
    const draftInput = (patch: Record<string, unknown> = {}) => ({ name: `${prefix} Mùa YEP`, goal: "Mở 2 Cơ hội YEP", targetOpportunities: 2, startKey, endKey: null, steps, options: DEFAULT_CAMPAIGN_OPTIONS, filter: { ...EMPTY_CAMPAIGN_FILTER, teamIds: [f.team.id], include: [ARCH.id, NOTEAM.id] }, assignments: {}, teamId: f.team.id, ...patch });

    let campaignId = "";
    await t.test("permissions: USER and a plain PIC cannot create; a manager only for a team they manage; Admin also team-less", async () => {
      assert.ok("error" in await saveCampaignDraft(db, userActor, { draft: draftInput() }));
      assert.ok("error" in await saveCampaignDraft(db, pic, { draft: draftInput() }));
      assert.ok("error" in await saveCampaignDraft(db, manager, { draft: draftInput({ teamId: null }) }));
      const teamless = await saveCampaignDraft(db, admin, { draft: draftInput({ teamId: null }) });
      assert.ok("ok" in teamless);
      assert.ok("error" in await deleteCampaignDraft(db, manager, { id: teamless.id, expectedVersion: 0 }), "a manager cannot touch a team-less campaign");
      assert.deepEqual(await deleteCampaignDraft(db, admin, { id: teamless.id, expectedVersion: 0 }), { ok: true });
      const saved = await saveCampaignDraft(db, manager, { draft: draftInput() });
      assert.ok("ok" in saved); campaignId = saved.id;
      const updated = await saveCampaignDraft(db, manager, { id: campaignId, expectedVersion: 0, draft: draftInput({ goal: "Mở 2 Cơ hội" }) });
      assert.deepEqual(updated, { ok: true, id: campaignId, version: 1 });
      assert.ok("error" in await saveCampaignDraft(db, manager, { id: campaignId, expectedVersion: 0, draft: draftInput() }), "stale draft version");
      assert.ok("error" in await launchCampaign(db, pic, { id: campaignId, expectedVersion: 1 }, effects));
    });

    await t.test("preview: archived, Bidding, other team and PIC without CRM access are excluded with reasons", async () => {
      const parsed = validateCampaignDraft(draftInput());
      assert.ok("ok" in parsed);
      const preview = await previewCampaign(db, parsed.value, now);
      assert.deepEqual(preview.selection.targets.map((x) => x.clientId).sort(), [A.id, B.id, CAD.id, EV.id].sort());
      const reasons = Object.fromEntries(preview.selection.excluded.map((x) => [x.clientId, x.reason]));
      assert.deepEqual(reasons, { [ARCH.id]: "ARCHIVED", [NOTEAM.id]: "OTHER_TEAM", [OUT.id]: "PIC_NOT_ALLOWED", [f.client.id]: "BIDDING" });
      assert.equal(preview.plan.tasks.length, 8);
      assert.deepEqual(preview.blockers, []);
      assert.ok(preview.pics.every((p) => p.allowed), "assignment choices are CRM-allowed PICs only");
    });

    await t.test("launch twice and in parallel creates exactly one task per client x step", async () => {
      const results = await Promise.all([1, 2, 3].map(() => launchCampaign(db, manager, { id: campaignId, expectedVersion: 1 }, effects)));
      assert.ok(results.every((r) => "ok" in r), JSON.stringify(results));
      assert.equal(results.filter((r) => "ok" in r && !r.alreadyLaunched).length, 1);
      const again = await launchCampaign(db, manager, { id: campaignId, expectedVersion: 1 }, effects);
      assert.ok("ok" in again && again.alreadyLaunched && again.tasks === 8 && again.targets === 4);
      const tasks = await db.task.findMany({ where: { careCampaignTask: { target: { campaignId } } }, include: { careCampaignTask: true } });
      assert.equal(tasks.length, 8);
      assert.ok(tasks.every((x) => x.crmKind === "CAMPAIGN" && x.status === "TODO" && x.projectId === null && x.opportunityId === null));
      assert.ok(tasks.every((x) => x.assigneeId === (x.clientId === B.id ? f.manager.id : f.pic.id)), "PIC of each client");
      const due = tasks.map((x) => [x.careCampaignTask!.stepIndex, vnDateKey(x.dueDate!)]);
      assert.ok(due.every(([i, key]) => key === (i === 0 ? startKey : vnDateKey(addDaysVn(today, 3)))));
      const campaign = await db.careCampaign.findUniqueOrThrow({ where: { id: campaignId } });
      assert.equal(campaign.status, "ACTIVE"); assert.equal(campaign.version, 2); assert.ok(campaign.launchedAt);
      assert.equal(vnDateKey(campaign.endDate!), vnDateKey(addDaysVn(today, 3)));
      assert.deepEqual(notices.map((n) => n.ids), [[f.pic.id]], "one notice per PIC, not the launcher, no email");
      assert.equal(await db.careCampaignTarget.count({ where: { campaignId, clientId: { in: [OUT.id, ARCH.id, NOTEAM.id, f.client.id] } } }), 0);
    });

    await t.test("Review shows campaign work with the campaign name", async () => {
      const review = await loadWeeklyReviewGroups(db, manager, { team: f.team.id }, now);
      const row = Object.values(review.groups).flat().find((r) => r.client.id === A.id);
      assert.equal(row?.reason.key, "CAMPAIGN");
      assert.equal(row?.reason.label, `Chiến dịch ${prefix} Mùa YEP`);
    });

    await t.test("cadence pause: no cadence task while a campaign step is open; event reminders unchanged; pause lifts it", async () => {
      await db.expectedEvent.create({ data: { clientId: EV.id, createdById: f.pic.id, programTypeCode: "MICE", precision: "DAY", year: 2027, date: addDaysVn(today, 90), source: "HISTORY", expectedEventSteps: { create: { kind: "OFFSET", offsetDays: 90, revision: 0, dueDate: today } } } });
      await runCrmReminderJob(db, { now, allowedPicUserIds: [f.pic.id, f.manager.id] });
      assert.equal(await db.task.count({ where: { clientId: CAD.id, crmKind: "CADENCE" } }), 0);
      assert.equal(await db.task.count({ where: { clientId: EV.id, crmKind: "EVENT_REMINDER" } }), 1);
      const paused = await changeCampaignStatus(db, manager, { id: campaignId, expectedVersion: 2, action: "PAUSE" });
      assert.deepEqual(paused, { ok: true, version: 3, cancelledTasks: 0 });
      assert.equal(await db.task.count({ where: { careCampaignTask: { target: { campaignId } }, status: "TODO" } }), 8, "pause keeps created tasks");
      await runCrmReminderJob(db, { now, allowedPicUserIds: [f.pic.id, f.manager.id] });
      assert.equal(await db.task.count({ where: { clientId: CAD.id, crmKind: "CADENCE" } }), 1);
      assert.ok("error" in await changeCampaignStatus(db, pic, { id: campaignId, expectedVersion: 3, action: "RESUME" }));
      assert.deepEqual(await changeCampaignStatus(db, manager, { id: campaignId, expectedVersion: 3, action: "RESUME" }), { ok: true, version: 4, cancelledTasks: 0 });
    });

    await t.test("Ghi kết quả completes a campaign step and feeds the funnel", async () => {
      const step0 = await db.task.findFirstOrThrow({ where: { clientId: A.id, careCampaignTask: { stepIndex: 0, target: { campaignId } } } });
      const logged = await logTouchpoint(db, pic, { clientRequestId: randomUUID(), clientId: A.id, opportunityId: null, kind: "MESSAGE", occurredAt: now, outcomeLevel: 2, notes: null, openOpportunity: null, next: { mode: "NEXT_STEP", title: "Gửi báo giá", assigneeId: f.pic.id, dueDate: addDaysVn(today, 7) }, completeTaskId: step0.id, confirmDraftId: null });
      assert.ok("ok" in logged, JSON.stringify(logged));
      const link = await db.careCampaignTask.findUniqueOrThrow({ where: { taskId: step0.id }, include: { task: true } });
      assert.equal(link.task.status, "DONE"); assert.equal(link.touchpointId, logged.touchpointId);
      const detail = await loadCampaignDetail(db, manager, campaignId, now);
      assert.equal(detail?.funnel.clients, 4); assert.equal(detail?.funnel.contacted, 1); assert.equal(detail?.funnel.responded, 1); assert.equal(detail?.funnel.needs, 0);
    });

    await t.test("opening an Opportunity stops the client's remaining steps with the reason; other clients continue", async () => {
      const opened = await openOpportunity(db, manager, { clientId: B.id, programTypeCode: "YEP", expectedYear: 2026, expectedMonth: 12, source: "OTHER", demandSignal: "YEP 2026" });
      assert.ok("ok" in opened, JSON.stringify(opened));
      const target = await db.careCampaignTarget.findUniqueOrThrow({ where: { campaignId_clientId: { campaignId, clientId: B.id } }, include: { tasks: { include: { task: true } } } });
      assert.equal(target.status, "STOPPED"); assert.equal(target.stoppedReason, CAMPAIGN_STOPPED_OPPORTUNITY);
      assert.ok(target.tasks.every((x) => x.task.status === "CANCELLED" && x.task.closedReason === CAMPAIGN_STOPPED_OPPORTUNITY));
      assert.equal(await db.task.count({ where: { clientId: A.id, crmKind: "CAMPAIGN", status: "TODO" } }), 1);
      const detail = await loadCampaignDetail(db, manager, campaignId, now);
      assert.equal(detail?.funnel.opportunities, 1);
      assert.equal(detail?.rows.find((r) => r.clientId === B.id)?.stoppedByOpportunity, true);
    });

    await t.test("PIC sees only own clients; outsiders see nothing", async () => {
      const own = await loadCampaignDetail(db, pic, campaignId, now);
      assert.deepEqual(own?.rows.map((r) => r.clientId).sort(), [A.id, CAD.id, EV.id].sort());
      assert.equal(own?.canManage, false);
      assert.equal(await loadCampaignDetail(db, await actor(f.outsider), campaignId, now), null);
      assert.ok((await loadCampaignList(db, pic)).some((c) => c.id === campaignId));
      assert.ok(!(await loadCampaignList(db, await actor(f.outsider))).some((c) => c.id === campaignId));
    });

    await t.test("PIC change mid-campaign: open steps follow an allowed new PIC; a PIC without CRM access gets nothing", async () => {
      const v0 = (await db.client.findUniqueOrThrow({ where: { id: EV.id } })).version;
      assert.ok("ok" in await changeClientPicOrTeam(db, manager, { clientId: EV.id, expectedVersion: v0, picAccountId: f.otherAccount.id, responsibleTeamId: f.team.id }, { notify: async () => {} }));
      const open = await db.task.findMany({ where: { clientId: EV.id, crmKind: "CAMPAIGN", status: "TODO" } });
      assert.equal(open.length, 2); assert.ok(open.every((x) => x.assigneeId === f.manager.id));
      assert.equal((await db.careCampaignTarget.findUniqueOrThrow({ where: { campaignId_clientId: { campaignId, clientId: EV.id } } })).picAccountId, f.otherAccount.id);
      assert.ok("ok" in await changeClientPicOrTeam(db, manager, { clientId: EV.id, expectedVersion: v0 + 1, picAccountId: outsiderAccount.id, responsibleTeamId: f.team.id }, { notify: async () => {} }));
      assert.ok((await db.task.findMany({ where: { clientId: EV.id, crmKind: "CAMPAIGN", status: "TODO" } })).every((x) => x.assigneeId === f.manager.id));
    });

    await t.test("merge mid-campaign: a target moves to the kept client; a duplicate target folds in and duplicate steps close", async () => {
      const M1 = await client("Merge 1", f.picAccount.id), M2 = await client("Merge 2", f.picAccount.id), X = await client("Move src", f.picAccount.id), Y = await client("Move dst", f.picAccount.id);
      const saved = await saveCampaignDraft(db, manager, { draft: draftInput({ name: `${prefix} Merge`, filter: { ...EMPTY_CAMPAIGN_FILTER, include: [M1.id, M2.id, X.id] } }) });
      assert.ok("ok" in saved);
      assert.ok("ok" in await launchCampaign(db, manager, { id: saved.id, expectedVersion: 0 }, effects));
      const merged = await mergeClients(db, admin, { sourceClientId: M1.id, targetClientId: M2.id, expectedSourceVersion: M1.version, expectedTargetVersion: M2.version });
      assert.ok("ok" in merged, JSON.stringify(merged));
      assert.equal(merged.movedCounts.campaignTargetsMerged, 1);
      const kept = await db.careCampaignTarget.findMany({ where: { campaignId: saved.id, clientId: M2.id }, include: { tasks: true } });
      assert.equal(kept.length, 1); assert.equal(kept[0].tasks.length, 2);
      assert.equal(await db.task.count({ where: { clientId: M2.id, crmKind: "CAMPAIGN", closedReason: CAMPAIGN_MERGED_DUPLICATE, status: "CANCELLED" } }), 2);
      const moved = await mergeClients(db, admin, { sourceClientId: X.id, targetClientId: Y.id, expectedSourceVersion: X.version, expectedTargetVersion: Y.version });
      assert.ok("ok" in moved && moved.movedCounts.campaignTargetsMoved === 1);
      assert.equal(await db.careCampaignTarget.count({ where: { campaignId: saved.id, clientId: Y.id } }), 1);
    });

    await t.test("cancel closes every open campaign task with the reason; finish needs no open steps", async () => {
      const current = await db.careCampaign.findUniqueOrThrow({ where: { id: campaignId } });
      assert.ok("error" in await changeCampaignStatus(db, manager, { id: campaignId, expectedVersion: current.version, action: "FINISH" }));
      const cancelled = await changeCampaignStatus(db, manager, { id: campaignId, expectedVersion: current.version, action: "CANCEL" });
      assert.ok("ok" in cancelled && cancelled.cancelledTasks === 5, JSON.stringify(cancelled));
      assert.equal(await db.task.count({ where: { careCampaignTask: { target: { campaignId } }, status: { notIn: ["DONE", "CANCELLED"] } } }), 0);
      assert.equal(await db.task.count({ where: { careCampaignTask: { target: { campaignId } }, closedReason: CAMPAIGN_CANCELLED } }), 5);
      assert.equal((await db.careCampaign.findUniqueOrThrow({ where: { id: campaignId } })).status, "CANCELLED");
      assert.ok("error" in await launchCampaign(db, manager, { id: campaignId, expectedVersion: current.version + 1 }, effects));
      assert.equal(await db.task.count({ where: { careCampaignTask: { target: { campaignId } } } }), 8, "no new tasks after cancel");
    });
  } finally {
    if (previousFlag === undefined) delete process.env.CRM_ENABLED; else process.env.CRM_ENABLED = previousFlag;
    if (f) await cleanupCrmFixture(db, prefix);
    if (original) {
      const { key, ...data } = original;
      await db.crmSetting.update({ where: { key }, data: { value: data.value as string[], version: data.version, updatedAt: data.updatedAt, updatedById: data.updatedById } });
      assert.deepEqual(await db.crmSetting.findUniqueOrThrow({ where: { key } }), original);
    } else await db.crmSetting.deleteMany({ where: { key: KEY } });
    await db.$disconnect();
  }
});
