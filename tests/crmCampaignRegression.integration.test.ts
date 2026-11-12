import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadCrmActorFrom } from "../lib/crm/actor";
import { loadCampaignDetail, loadCampaignList, previewCampaign } from "../lib/crm/campaignData";
import { DEFAULT_CAMPAIGN_OPTIONS, EMPTY_CAMPAIGN_FILTER, type CampaignDraft } from "../lib/crm/campaignPlan";
import { launchCampaign, saveCampaignDraft } from "../lib/crm/campaignService";
import { addDaysVn, vnDateKey, vnDayStart } from "../lib/crm/dates";
import { loadWeeklyReview, loadWeeklyReviewGroups } from "../lib/crm/reviewData";
import { logTouchpoint } from "../lib/crm/touchpoints";
import { rowActionsFor } from "../lib/crm/reviewView";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("crm52 review regressions: assignment, destination load and PIC counts", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb(), prefix = `camp-reg-${randomUUID()}`;
  const keys = ["access.users", "campaign.weeklyLoadWarn"];
  const original = await db.crmSetting.findMany({ where: { key: { in: keys } } });
  const previousFlag = process.env.CRM_ENABLED;
  try {
    const f = await seedCrmFixture(db, prefix);
    process.env.CRM_ENABLED = "true";
    const access = original.find((r) => r.key === "access.users");
    const users = [...new Set([...(Array.isArray(access?.value) ? access.value as string[] : []), f.pic.id, f.manager.id])];
    await db.crmSetting.upsert({ where: { key: "access.users" }, create: { key: "access.users", value: users }, update: { value: users } });
    await db.crmSetting.upsert({ where: { key: "campaign.weeklyLoadWarn" }, create: { key: "campaign.weeklyLoadWarn", value: { perWeek: 1 } }, update: { value: { perWeek: 1 } } });
    const actor = async (u: typeof f.admin) => ({ ...await loadCrmActorFrom(db, u), name: u.name });
    const admin = await actor(f.admin), pic = await actor(f.pic), manager = await actor(f.manager);
    const now = new Date(), today = vnDayStart(now);
    const draft = (patch: Partial<CampaignDraft>): CampaignDraft => ({
      name: `${prefix} campaign`, goal: null, targetOpportunities: null, startKey: vnDateKey(now), endKey: null,
      steps: [{ offsetDays: 0, title: "Gọi khách", kind: "CALL" }], options: DEFAULT_CAMPAIGN_OPTIONS,
      filter: EMPTY_CAMPAIGN_FILTER, assignments: {}, teamId: null, ...patch,
    });
    const launch = async (input: CampaignDraft) => {
      const saved = await saveCampaignDraft(db, admin, { draft: input }); assert.ok("ok" in saved);
      const result = await launchCampaign(db, admin, { id: saved.id, expectedVersion: saved.version }, { notify: async () => {} });
      assert.ok("ok" in result, JSON.stringify(result)); return saved.id;
    };

    await t.test("load preview includes a potential recipient's existing tasks before suggesting a move", async () => {
      const c = await db.client.create({ data: { name: `${prefix} Load`, picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
      await db.task.createMany({ data: [f.pic.id, ...Array<string>(10).fill(f.manager.id)].map((assigneeId) => ({
        title: "Existing CRM work", clientId: c.id, assigneeId, creatorId: f.admin.id, dueDate: today, crmKind: "NEXT_STEP",
      })) });
      const preview = await previewCampaign(db, draft({ filter: { ...EMPTY_CAMPAIGN_FILTER, include: [c.id] } }), now);
      assert.ok(!preview.plan.suggestions.some((s) => s.kind === "MOVE" && s.toAccountId === f.otherAccount.id));
      assert.equal(preview.plan.load.rows.find((r) => r.userId === f.manager.id)?.cells[0].existing, 10);
    });

    await t.test("unowned and overridden clients appear in full/narrow Review for the assigned PIC and support Ghi kết quả", async () => {
      const noPic = await db.client.create({ data: { name: `${prefix} No PIC` } });
      const overridden = await db.client.create({ data: { name: `${prefix} Override`, picAccountId: f.otherAccount.id } });
      // An earlier task for somebody else must not hide the assigned campaign step under the me filter.
      await db.task.create({ data: { title: "Other person's earlier task", clientId: overridden.id, assigneeId: f.manager.id, creatorId: f.admin.id, crmKind: "NEXT_STEP", dueDate: addDaysVn(today, -1) } });
      const id = await launch(draft({ filter: { ...EMPTY_CAMPAIGN_FILTER, include: [noPic.id, overridden.id] }, assignments: { [noPic.id]: f.picAccount.id, [overridden.id]: f.picAccount.id } }));
      for (const raw of [{}, { team: "all", pic: "me" }, { team: f.team.id, pic: f.picAccount.id }]) {
        const [full, narrow] = await Promise.all([loadWeeklyReview(db, pic, raw, now), loadWeeklyReviewGroups(db, pic, raw, now)]);
        const rows = Object.values(narrow.groups).flat();
        for (const c of [noPic, overridden]) {
          const row = rows.find((r) => r.client.id === c.id);
          assert.equal(row?.reason.key, "CAMPAIGN", JSON.stringify(raw));
          assert.equal(row?.assignee?.id, f.pic.id); assert.equal(row?.can.logResult, true);
          assert.equal(rowActionsFor(row!.group, row!).primary, "LOG_RESULT");
        }
        assert.deepEqual(full.groups, narrow.groups);
      }
      const review = await loadWeeklyReviewGroups(db, pic, { team: "all", pic: "me" }, now);
      const row = Object.values(review.groups).flat().find((r) => r.client.id === noPic.id)!;
      const logged = await logTouchpoint(db, pic, { clientRequestId: randomUUID(), clientId: noPic.id, opportunityId: null,
        kind: "CALL", occurredAt: now, outcomeLevel: 2, notes: null, openOpportunity: null,
        next: { mode: "NEXT_STEP", title: "Follow up", assigneeId: f.pic.id, dueDate: addDaysVn(today, 7) }, completeTaskId: row.taskId, confirmDraftId: null });
      assert.ok("ok" in logged, JSON.stringify(logged));
      assert.equal((await loadCampaignDetail(db, pic, id, now))?.funnel.responded, 1);
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: noPic.id } })).picAccountId, null);
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: overridden.id } })).picAccountId, f.otherAccount.id);
      const outsider = await loadWeeklyReviewGroups(db, await actor(f.outsider), { team: "all" }, now);
      assert.ok(!Object.values(outsider.groups).flat().some((r) => r.client.id === noPic.id));
    });

    await t.test("campaign list totals match the target scope of the detail screen for PIC, manager and Admin", async () => {
      const own = await db.client.create({ data: { name: `${prefix} Own`, picAccountId: f.picAccount.id, responsibleTeamId: f.team.id } });
      const other = await db.client.create({ data: { name: `${prefix} Other`, picAccountId: f.otherAccount.id, responsibleTeamId: f.team.id } });
      const id = await launch(draft({ teamId: f.team.id, filter: { ...EMPTY_CAMPAIGN_FILTER, include: [own.id, other.id] } }));
      const ownTask = await db.task.findFirstOrThrow({ where: { clientId: own.id, careCampaignTask: { target: { campaignId: id } } } });
      await db.task.update({ where: { id: ownTask.id }, data: { status: "DONE", completedAt: now } });
      for (const [viewer, count, open] of [[pic, 1, 0], [manager, 2, 1], [admin, 2, 1]] as const) {
        const list = (await loadCampaignList(db, viewer)).find((r) => r.id === id)!;
        const detail = await loadCampaignDetail(db, viewer, id, now); assert.ok(detail);
        assert.equal(list.clients, count); assert.equal(list.clients, detail.rows.length);
        assert.equal(list.openTasks, open); assert.equal(list.openTasks, detail.openTasks); assert.equal(list.doneTasks, 1);
      }
    });
  } finally {
    await cleanupCrmFixture(db, prefix);
    for (const key of keys) {
      const row = original.find((r) => r.key === key);
      if (row) await db.crmSetting.update({ where: { key }, data: { value: row.value!, version: row.version, updatedAt: row.updatedAt, updatedById: row.updatedById } });
      else await db.crmSetting.deleteMany({ where: { key } });
    }
    if (previousFlag === undefined) delete process.env.CRM_ENABLED; else process.env.CRM_ENABLED = previousFlag;
    await db.$disconnect();
  }
});
