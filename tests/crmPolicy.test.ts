import assert from "node:assert/strict";
import { test } from "node:test";
import { crmCan, type CrmAction, type CrmActor, type CrmResource } from "../lib/crm/policy";

const actions: CrmAction[] = ["VIEW", "EDIT", "CHANGE_PIC_OR_TEAM", "ASSIGN", "LOG_TOUCHPOINT", "EDIT_TASK", "SCORE_POTENTIAL", "CLOSE_OPPORTUNITY", "CONFIRM_IMPORTED_CLIENT", "REVIEW_IMPORT", "MERGE_CLIENT", "CONFIGURE"];
const actor = (id: string, extra: Partial<CrmActor> = {}): CrmActor => ({ id, role: "USER", accountId: null, managedTeamIds: [], isDataSteward: false, ...extra });
const client: CrmResource = { kind: "CLIENT", picUserId: "pic", teamId: "T" };
const task: CrmResource = { kind: "TASK", owner: client, assigneeId: "assignee", creatorId: "creator" };
const rows: [string, CrmActor, CrmAction[]][] = [
  ["admin", actor("admin", { role: "ADMIN" }), actions],
  ["manager", actor("manager", { managedTeamIds: ["T"] }), ["VIEW", "EDIT", "CHANGE_PIC_OR_TEAM", "ASSIGN", "LOG_TOUCHPOINT", "EDIT_TASK", "SCORE_POTENTIAL", "CLOSE_OPPORTUNITY"]],
  ["pic", actor("pic"), ["VIEW", "EDIT", "ASSIGN", "LOG_TOUCHPOINT", "EDIT_TASK", "CLOSE_OPPORTUNITY", "CONFIRM_IMPORTED_CLIENT"]],
  ["assignee", actor("assignee"), ["VIEW", "EDIT_TASK", "LOG_TOUCHPOINT"]],
  ["other assignee", actor("other"), ["VIEW"]],
  ["outsider", actor("outsider"), ["VIEW"]],
  ["steward", actor("steward", { isDataSteward: true }), ["VIEW", "REVIEW_IMPORT", "MERGE_CLIENT"]],
];
for (const [name, user, allowed] of rows) {
  for (const action of actions) test(`${name}: ${action}`, () => {
    assert.equal(crmCan(user, action, task), allowed.includes(action));
    assert.equal(crmCan(user, action, client), allowed.includes(action) && !(name === "assignee" && action !== "VIEW"));
  });
}
test("wrong team, unassigned records and task creator grant no management privilege", () => {
  assert.equal(crmCan(actor("manager", { managedTeamIds: ["U"] }), "EDIT", client), false);
  assert.equal(crmCan(actor("creator"), "EDIT_TASK", task), false);
  assert.equal(crmCan(actor("outsider"), "EDIT", { kind: "CLIENT", picUserId: null, teamId: null }), false);
});
test("closed opportunities deny every non-VIEW action for everyone, including their tasks", () => {
  const closed = { kind: "OPPORTUNITY" as const, picUserId: "pic", teamId: "T", closed: true };
  for (const [, user] of rows) for (const action of actions) {
    assert.equal(crmCan(user, action, closed), action === "VIEW");
    assert.equal(crmCan(user, action, { ...task, owner: closed }), action === "VIEW");
  }
});
