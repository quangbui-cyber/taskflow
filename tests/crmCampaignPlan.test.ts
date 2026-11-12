import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN_MAX_CLIENTS, CAMPAIGN_MAX_STEPS, DEFAULT_CAMPAIGN_OPTIONS, EMPTY_CAMPAIGN_FILTER, SUGGESTED_CAMPAIGN_TEMPLATES,
  campaignEndKey, isoWeekKey, launchBlockers, parseCampaignAssignments, parseCampaignFilter, parseCampaignOptions, parseCampaignSteps,
  parseWeeklyLoadWarn, planCampaign, scheduleCampaign, selectCampaignClients, suggestLoadFixes, validateCampaignDraft, weeklyLoad,
  type CampaignCandidate, type CampaignPic,
} from "../lib/crm/campaignPlan";

const candidate = (id: string, patch: Partial<CampaignCandidate> = {}): CampaignCandidate => ({
  id, name: `Khách ${id}`, tier: "A", lifecycle: "ACTIVE", archived: false, tagIds: [], industry: null, teamId: "t1",
  picAccountId: "acc-minh", seasonMonths: [], bidding: false, ...patch,
});
const pics: CampaignPic[] = [
  { accountId: "acc-minh", userId: "u-minh", name: "Minh", teamId: "t1", allowed: true },
  { accountId: "acc-huy", userId: "u-huy", name: "Huy", teamId: "t1", allowed: true },
  { accountId: "acc-out", userId: "u-out", name: "Ngoài", teamId: "t1", allowed: false },
  { accountId: "acc-nouser", userId: null, name: "Không tài khoản", teamId: "t1", allowed: false },
];
const ctx = { teamId: null, skipBidding: true, pics, assignments: {} };
const steps = [
  { offsetDays: 0, title: "Gửi email gợi ý concept YEP", kind: "MESSAGE" },
  { offsetDays: 5, title: "Gọi hỏi kế hoạch YEP", kind: "CALL" },
  { offsetDays: 12, title: "Hẹn gặp trình bày", kind: "MEETING" },
] as const;

test("filters match on every non-empty criterion; empty criteria match nobody", () => {
  const list = [
    candidate("1", { tier: "S", tagIds: ["fin"], industry: "Ngân hàng", seasonMonths: [12] }),
    candidate("2", { tier: "B", tagIds: ["fin"], industry: "Ngân hàng", seasonMonths: [11, 12] }),
    candidate("3", { tier: "C", lifecycle: "DORMANT", seasonMonths: [12] }),
    candidate("4", { tier: "A", picAccountId: "acc-huy", teamId: "t2" }),
  ];
  assert.equal(selectCampaignClients(list, EMPTY_CAMPAIGN_FILTER, ctx).targets.length, 0);
  const byTier = selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, tiers: ["S", "B"] }, ctx);
  assert.deepEqual(byTier.targets.map((t) => t.clientId), ["1", "2"]);
  const combined = selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, tagIds: ["fin"], seasonMonths: [11] }, ctx);
  assert.deepEqual(combined.targets.map((t) => t.clientId), ["2"]);
  assert.deepEqual(selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, lifecycles: ["DORMANT"] }, ctx).targets.map((t) => t.clientId), ["3"]);
  assert.deepEqual(selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, industries: ["Ngân hàng"], tiers: ["S"] }, ctx).targets.map((t) => t.clientId), ["1"]);
  assert.deepEqual(selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, teamIds: ["t2"] }, ctx).targets.map((t) => t.clientId), ["4"]);
  assert.deepEqual(selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, picAccountIds: ["acc-huy"] }, ctx).targets.map((t) => t.clientId), ["4"]);
});

test("manual add and remove change the filter result; counts match the wizard summary", () => {
  const list = [candidate("1"), candidate("2"), candidate("3"), candidate("4", { tier: "C" })];
  const result = selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, tiers: ["A"], exclude: ["2"], include: ["4", "missing"] }, ctx);
  assert.equal(result.matched, 3);
  assert.equal(result.removed, 1);
  assert.equal(result.added, 1);
  assert.deepEqual(result.targets.map((t) => t.clientId), ["1", "3", "4"]);
});

test("archived clients are always excluded, even when added by hand", () => {
  const list = [candidate("1"), candidate("2", { archived: true, lifecycle: "ARCHIVED" })];
  const result = selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, tiers: ["A"], include: ["2"] }, ctx);
  assert.deepEqual(result.targets.map((t) => t.clientId), ["1"]);
  assert.deepEqual(result.excluded, [{ clientId: "2", name: "Khách 2", reason: "ARCHIVED" }]);
  assert.equal(result.matched, 1, "archived clients never count as matched");
});

test("a team campaign keeps only clients of that team; Bidding is skipped only when the option is on", () => {
  const list = [candidate("1"), candidate("2", { teamId: "t2" }), candidate("3", { bidding: true })];
  const team = selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, tiers: ["A"] }, { ...ctx, teamId: "t1" });
  assert.deepEqual(team.targets.map((t) => t.clientId), ["1"]);
  assert.deepEqual(team.excluded.map((e) => [e.clientId, e.reason]), [["2", "OTHER_TEAM"], ["3", "BIDDING"]]);
  const keepBidding = selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, tiers: ["A"] }, { ...ctx, skipBidding: false });
  assert.deepEqual(keepBidding.targets.map((t) => t.clientId), ["1", "2", "3"]);
});

test("only CRM-allowed PICs receive work; a reassignment to an allowed PIC brings the client back", () => {
  const list = [candidate("1"), candidate("2", { picAccountId: "acc-out" }), candidate("3", { picAccountId: null }), candidate("4", { picAccountId: "acc-nouser" })];
  const filter = { ...EMPTY_CAMPAIGN_FILTER, tiers: ["A" as const] };
  const result = selectCampaignClients(list, filter, ctx);
  assert.deepEqual(result.targets.map((t) => [t.clientId, t.picUserId]), [["1", "u-minh"]]);
  assert.deepEqual(result.excluded.map((e) => [e.clientId, e.reason]), [["2", "PIC_NOT_ALLOWED"], ["3", "NO_PIC"], ["4", "PIC_NOT_ALLOWED"]]);
  const reassigned = selectCampaignClients(list, filter, { ...ctx, assignments: { "2": "acc-huy", "3": "acc-huy", "4": "acc-out" } });
  assert.deepEqual(reassigned.targets.map((t) => [t.clientId, t.picAccountId, t.reassigned]), [["1", "acc-minh", false], ["2", "acc-huy", true], ["3", "acc-huy", true]]);
  assert.deepEqual(reassigned.excluded.map((e) => [e.clientId, e.reason]), [["4", "PIC_NOT_ALLOWED"]]);
});

test("more than 200 clients is flagged and blocks launch", () => {
  const list = Array.from({ length: CAMPAIGN_MAX_CLIENTS + 1 }, (_, i) => candidate(String(i).padStart(3, "0")));
  const result = selectCampaignClients(list, { ...EMPTY_CAMPAIGN_FILTER, tiers: ["A"] }, ctx);
  assert.equal(result.overLimit, true);
  assert.ok(launchBlockers({ steps: [...steps], targets: result.targets.length }).some((m) => m.includes("200")));
  assert.deepEqual(launchBlockers({ steps: [...steps], targets: CAMPAIGN_MAX_CLIENTS }), []);
  assert.ok(launchBlockers({ steps: [], targets: 3 }).length);
  assert.ok(launchBlockers({ steps: [...steps], targets: 0 }).length);
});

test("step dates are N days after the Vietnam start date, weekends and holidays unchanged", () => {
  const scheduled = scheduleCampaign("2026-11-14", [...steps]);
  assert.deepEqual(scheduled.map((s) => s.dueKey), ["2026-11-14", "2026-11-19", "2026-11-26"]);
  assert.equal(scheduled[0].dueDate.toISOString(), "2026-11-13T17:00:00.000Z", "midnight in Vietnam");
  assert.equal(campaignEndKey("2026-11-14", [...steps]), "2026-11-26");
  assert.equal(campaignEndKey("2026-12-30", [{ offsetDays: 3, title: "x", kind: "CALL" }]), "2027-01-02");
});

test("ISO weeks follow the Vietnam calendar date", () => {
  assert.equal(isoWeekKey("2026-11-16"), "2026-W47");
  assert.equal(isoWeekKey("2026-11-22"), "2026-W47");
  assert.equal(isoWeekKey("2026-11-23"), "2026-W48");
  assert.equal(isoWeekKey("2027-01-01"), "2026-W53");
  assert.equal(isoWeekKey("2027-01-04"), "2027-W01");
});

test("weekly load adds existing open CRM work to planned campaign work; no threshold means no warning", () => {
  const planned = [{ userId: "u1", dateKey: "2026-11-16" }, { userId: "u1", dateKey: "2026-11-17" }, { userId: "u2", dateKey: "2026-11-24" }];
  const existing = [{ userId: "u1", dateKey: "2026-11-18" }, { userId: "u1", dateKey: "2026-12-30" }, { userId: "u3", dateKey: "2026-11-16" }];
  const none = weeklyLoad({ planned, existing, threshold: null });
  assert.deepEqual(none.weeks, ["2026-W47", "2026-W48"]);
  assert.deepEqual(none.rows.map((r) => [r.userId, r.cells.map((c) => [c.existing, c.planned, c.total])]), [
    ["u1", [[1, 2, 3], [0, 0, 0]]],
    ["u2", [[0, 0, 0], [0, 1, 1]]],
  ]);
  assert.deepEqual(none.warnings, []);
  const warned = weeklyLoad({ planned, existing, threshold: 2 });
  assert.deepEqual(warned.warnings, [{ userId: "u1", week: "2026-W47", total: 3 }]);
  assert.equal(warned.rows[0].cells[0].over, true);
});

test("suggestions move clients to the least loaded allowed PIC or stretch a step into next week", () => {
  const plan = planCampaign({
    startKey: "2026-11-16", steps: [{ offsetDays: 0, title: "Email", kind: "MESSAGE" }, { offsetDays: 2, title: "Gọi", kind: "CALL" }],
    targets: ["a", "b", "c"].map((id) => ({ clientId: id, name: `Khách ${id}`, picAccountId: "acc-minh", picUserId: "u-minh", picName: "Minh", reassigned: false })),
    existing: [], threshold: 4, allowedPics: pics.filter((p) => p.allowed),
  });
  assert.deepEqual(plan.load.warnings, [{ userId: "u-minh", week: "2026-W47", total: 6 }]);
  assert.deepEqual(plan.suggestions, [
    { kind: "MOVE", fromAccountId: "acc-minh", toAccountId: "acc-huy", toName: "Huy", week: "2026-W47", clientIds: ["c"] },
    { kind: "STRETCH", stepIndex: 1, addDays: 5, week: "2026-W47" },
  ]);
  assert.equal(plan.tasks.length, 6);
  const quiet = suggestLoadFixes({ warnings: [], rows: [], threshold: null, targets: [], steps: [], startKey: "2026-11-16", allowedPics: [] });
  assert.deepEqual(quiet, []);
});

test("steps, options, filter, assignments and load threshold parse strictly", () => {
  assert.deepEqual(parseCampaignSteps([...steps]), [...steps]);
  assert.equal(parseCampaignSteps(Array.from({ length: CAMPAIGN_MAX_STEPS + 1 }, () => steps[0])), null);
  assert.equal(parseCampaignSteps([{ ...steps[0], offsetDays: 181 }]), null);
  assert.equal(parseCampaignSteps([{ ...steps[0], offsetDays: -1 }]), null);
  assert.equal(parseCampaignSteps([{ ...steps[0], kind: "SMS" }]), null);
  assert.equal(parseCampaignSteps([{ ...steps[0], title: " " }]), null);
  assert.equal(parseCampaignSteps([{ ...steps[0], giftValue: 500000 }]), null, "no gift value or other extra fields");
  assert.deepEqual(parseCampaignOptions({}), null);
  assert.deepEqual(parseCampaignOptions(DEFAULT_CAMPAIGN_OPTIONS), { stopOnOpportunity: true, skipBidding: true, pauseCadence: true });
  assert.deepEqual(parseCampaignFilter({ ...EMPTY_CAMPAIGN_FILTER, seasonMonths: [12] })?.seasonMonths, [12]);
  assert.equal(parseCampaignFilter({ ...EMPTY_CAMPAIGN_FILTER, seasonMonths: [13] }), null);
  assert.equal(parseCampaignFilter({ ...EMPTY_CAMPAIGN_FILTER, tiers: ["Z"] }), null);
  assert.equal(parseCampaignFilter({ ...EMPTY_CAMPAIGN_FILTER, include: Array.from({ length: 401 }, (_, i) => `c${i}`) }), null);
  assert.deepEqual(parseCampaignAssignments({ c1: "acc-1" }), { c1: "acc-1" });
  assert.equal(parseCampaignAssignments({ __proto__: "x", c1: 3 }), null);
  assert.deepEqual(parseWeeklyLoadWarn({ perWeek: 12 }), { perWeek: 12 });
  assert.deepEqual(parseWeeklyLoadWarn({ perWeek: null }), { perWeek: null });
  for (const bad of [{ perWeek: 0 }, { perWeek: 1.5 }, { perWeek: 1000 }, 12, null]) assert.equal(parseWeeklyLoadWarn(bad), null);
});

test("draft validation: name required, end after the last step, steps within limits", () => {
  const base = { name: "Mùa YEP 2026", goal: "Mở 6 Cơ hội YEP", targetOpportunities: 6, startKey: "2026-11-17", endKey: "2026-12-12", steps: [...steps], options: DEFAULT_CAMPAIGN_OPTIONS, filter: EMPTY_CAMPAIGN_FILTER, assignments: {}, teamId: null };
  const ok = validateCampaignDraft(base);
  assert.ok("ok" in ok);
  assert.ok("errors" in validateCampaignDraft({ ...base, name: "  " }));
  assert.ok("errors" in validateCampaignDraft({ ...base, endKey: "2026-11-20" }));
  assert.ok("errors" in validateCampaignDraft({ ...base, startKey: "2026-02-30" }));
  assert.ok("errors" in validateCampaignDraft({ ...base, targetOpportunities: -1 }));
  assert.ok("ok" in validateCampaignDraft({ ...base, steps: [], endKey: null }), "drafts may be saved before steps are chosen");
});

test("suggested templates are four agency plans without gift values", () => {
  assert.deepEqual(SUGGESTED_CAMPAIGN_TEMPLATES.map((t) => t.name), ["Mùa YEP", "Chúc Tết", "Gửi hồ sơ năng lực", "Sau sự kiện"]);
  for (const template of SUGGESTED_CAMPAIGN_TEMPLATES) assert.deepEqual(parseCampaignSteps(template.steps), template.steps);
});
