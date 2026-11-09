import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as parsers from "../lib/crm/opportunityInput";
import { crmCan } from "../lib/crm/policy";

type Action = (raw: unknown) => Promise<Record<string, unknown>>;
function harness() {
  const state = { enabled: true, auth: 0, actors: 0, services: 0, database: 0, alreadyWon: false, throwWin: false, throwEffects: false, denied: false, handovers: 0, revalidations: [] as string[], deferred: [] as (() => Promise<void>)[], notices: [] as { ids: string[]; data: Record<string, unknown> }[] };
  const user = { id: "actor", name: "Actor", role: "ACCOUNT" };
  const service = (value: Record<string, unknown>) => async () => { state.services++; return state.denied ? { error: "Denied by persisted owner" } : value; };
  const modules: Record<string, unknown> = {
    "next/server": { after: (fn: () => Promise<void>) => { if (state.throwEffects) throw new Error("after unavailable"); state.deferred.push(fn); } },
    "next/cache": { revalidatePath: (path: string) => { if (state.throwEffects) throw new Error("cache unavailable"); state.revalidations.push(path); } },
    "@/lib/auth": { requireUser: async () => { state.auth++; return user; } },
    "@/lib/prisma": { prisma: { opportunity: { findUnique: async () => { state.database++; return { clientId: "client" }; }, findUniqueOrThrow: async () => { state.database++; return { name: "Event", opportunityMembers: [{ userId: "actor" }, { userId: "member" }] }; } } } },
    "@/lib/features": { crmEnabled: () => state.enabled, CRM_DISABLED_MESSAGE: "Disabled" },
    "@/lib/crm/actor": { loadCrmActor: async () => { state.actors++; return { ...user, accountId: null, managedTeamIds: [], isDataSteward: false }; }, loadOpportunityResource: async () => ({ kind: "OPPORTUNITY", closed: false, picUserId: null, teamId: null }) },
    "@/lib/crm/policy": { crmCan },
    "@/lib/notify": { notify: async (ids: string[], data: Record<string, unknown>) => { if (state.throwEffects) throw new Error("notify unavailable"); state.notices.push({ ids, data }); } },
    "@/lib/crm/opportunityWorkflow": { openOpportunity: service({ ok: true, opportunityId: "opp", version: 0 }), advanceStage: service({ ok: true, closedReminders: 3, version: 2 }), closeOpportunity: service({ ok: true, cancelledTasks: 2 }) },
    "@/lib/crm/opportunityService": { editOpportunity: service({ ok: true, version: 2 }), changeOpportunityPicOrTeam: service({ ok: true, version: 2 }) },
    "@/lib/crm/opportunityWin": { winOpportunity: async () => { state.services++; if (state.throwWin) throw new Error("private SQL details"); return state.denied ? { error: "Denied by persisted owner" } : { ok: true, projectId: "project", projectName: "Signed project", alreadyWon: state.alreadyWon }; }, winPreview: service({ tasks: 2, files: 3, meetings: 1, budgetMin: { valueOf: () => 1000 }, budgetMax: null }) },
    "@/lib/crm/opportunityDrive": { handOverOpportunityDrive: async () => { state.handovers++; } },
    "@/lib/crm/opportunityInput": parsers,
  };
  const source = readFileSync(resolve("app/actions/crmOpportunities.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, require: (name: string) => { if (!(name in modules)) throw new Error(`Unexpected import ${name}`); return modules[name]; }, console: { warn: () => {} } });
  return { state, actions: compiledModule.exports as Record<string, Action> };
}
const valid = {
  openOpportunityAction: { clientId: "client", programTypeCode: "MICE", expectedYear: 2027, expectedMonth: 3, source: "REPEAT", demandSignal: "Confirmed" },
  advanceOpportunityStageAction: { opportunityId: "opp", expectedVersion: 1, to: "BRIEF", briefReceivedAt: "2026-10-15" },
  closeOpportunityAction: { opportunityId: "opp", expectedVersion: 1, outcome: "CS_DECLINED", reasonId: "reason" },
  editOpportunityAction: { opportunityId: "opp", expectedVersion: 1, name: "Revised" },
  changeOpportunityPicOrTeamAction: { opportunityId: "opp", expectedVersion: 1, picAccountId: "pic", responsibleTeamId: null },
  winOpportunityAction: { opportunityId: "opp", expectedVersion: 1, contractValue: "1.000", wonAt: "2026-10-15", projectName: "Signed project" },
  winPreviewAction: "opp",
};
test("all seven actions authenticate and stop before actor/DB/services when CRM is disabled", async () => {
  const { state, actions } = harness(); state.enabled = false;
  for (const [name, input] of Object.entries(valid)) assert.equal((await actions[name](input)).error, "Disabled");
  assert.equal(state.auth, 7); assert.equal(state.actors, 0); assert.equal(state.services, 0); assert.equal(state.database, 0); assert.equal(state.deferred.length, 0);
});
test("all seven actions reject malformed input before touching DB or resolving actors", async () => {
  const { state, actions } = harness();
  for (const name of Object.keys(valid)) assert.ok((await actions[name]([])).error);
  assert.equal(state.auth, 7); assert.equal(state.actors, 0); assert.equal(state.services, 0); assert.equal(state.database, 0);
});
test("service authorization errors pass through without refresh or effects", async () => {
  const { state, actions } = harness(); state.denied = true;
  for (const [name, input] of Object.entries(valid)) { if (name === "winPreviewAction") continue; assert.equal((await actions[name](input)).error, "Denied by persisted owner"); }
  assert.equal(state.revalidations.length, 0); assert.equal(state.notices.length, 0); assert.equal(state.deferred.length, 0);
});
test("success copy, reminder count and CRM/client paths match the action contract", async () => {
  const { state, actions } = harness();
  assert.equal((await actions.openOpportunityAction(valid.openOpportunityAction)).success, "Đã mở Cơ hội.");
  assert.equal((await actions.advanceOpportunityStageAction(valid.advanceOpportunityStageAction)).success, "Đã chuyển sang Brief. Đã đóng 3 nhắc của chương trình này.");
  assert.equal((await actions.closeOpportunityAction(valid.closeOpportunityAction)).success, "Đã lưu kết quả.");
  assert.equal((await actions.editOpportunityAction(valid.editOpportunityAction)).success, "Đã lưu thay đổi.");
  assert.equal((await actions.changeOpportunityPicOrTeamAction(valid.changeOpportunityPicOrTeamAction)).success, "Đã lưu thay đổi.");
  for (const path of ["/crm", "/crm/opportunities", "/crm/opportunities/opp", "/crm/clients/client"]) assert.ok(state.revalidations.includes(path));
});
test("win schedules Drive only after commit, excludes actor from notification and repeated win has no effects", async () => {
  const { state, actions } = harness();
  const result = await actions.winOpportunityAction(valid.winOpportunityAction); assert.equal(result.success, "Đã tạo Project Signed project."); assert.equal(result.projectId, "project");
  assert.equal(state.handovers, 0); assert.equal(state.deferred.length, 1); assert.deepEqual(state.notices[0].ids, ["member"]); assert.equal(state.notices[0].data.opportunityId, "opp");
  await state.deferred[0](); assert.equal(state.handovers, 1);
  state.alreadyWon = true; await actions.winOpportunityAction(valid.winOpportunityAction); assert.equal(state.deferred.length, 1); assert.equal(state.notices.length, 1);
  for (const path of ["/", "/projects", "/projects/project"]) assert.ok(state.revalidations.includes(path));
});
test("unexpected win failure uses safe copy and viewers can preview numeric budgets", async () => {
  const { state, actions } = harness(); state.throwWin = true;
  assert.equal((await actions.winOpportunityAction(valid.winOpportunityAction)).error, "Chưa tạo được Project. Cơ hội vẫn ở Bidding, thử lại sau ít phút."); assert.equal(state.deferred.length, 0);
  const result = await actions.winPreviewAction("opp"); assert.equal(result.budgetMin, 1000); assert.equal(result.budgetMax, null); assert.equal(result.tasks, 2);
});
test("post-commit scheduling or notification failure never claims the committed win is still Bidding", async () => {
  const { state, actions } = harness(); state.throwEffects = true;
  const result = await actions.winOpportunityAction(valid.winOpportunityAction);
  assert.equal(result.projectId, "project"); assert.equal(result.error, undefined); assert.equal(result.success, "Đã tạo Project Signed project.");
});
