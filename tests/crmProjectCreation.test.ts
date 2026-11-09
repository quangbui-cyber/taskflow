import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_STATUSES } from "../lib/types";
import {
  checkProjectCategoryChange, checkProjectCreation, checkProjectStatusChange,
  projectCreationMode, visibleProjectStatusKeys, PROJECT_FROM_OPPORTUNITY_ERROR,
  PILOT_TEAM_PROJECT_ERROR, STATUS_TRACKED_IN_OPPORTUNITY_ERROR,
  type ProjectCreationContext,
} from "../lib/crm/projectCreation";

const official: ProjectCreationContext = {
  crmOn: true, actorTeamId: "t2",
  setting: { mode: "OPPORTUNITY_OFFICIAL", pilotTeamIds: ["t1"], plannedCutoverDate: null },
};
const pilot: ProjectCreationContext = { ...official, setting: { ...official.setting, mode: "PROJECT_OFFICIAL" } };
const client = { category: "CLIENT" as const, accountTeamId: "t2", isPurchaseOrderImport: false };

test("official creation requires Opportunity except internal and PO paths; flag off preserves legacy", () => {
  assert.deepEqual(checkProjectCreation(official, client), { error: PROJECT_FROM_OPPORTUNITY_ERROR });
  assert.deepEqual(checkProjectCreation(official, { ...client, category: "INTERNAL" }), { ok: true, initialStatus: "ON_PROCESS" });
  assert.deepEqual(checkProjectCreation(official, { ...client, isPurchaseOrderImport: true }), { ok: true, initialStatus: "ON_PROCESS" });
  assert.deepEqual(checkProjectCreation({ ...official, crmOn: false }, client), { ok: true, initialStatus: "BIDDING" });
  assert.deepEqual(checkProjectCreation({ ...official, crmOn: false }, { ...client, isPurchaseOrderImport: true }), { ok: true, initialStatus: "ON_PROCESS" });
});

test("pilot creation checks actor and selected Account teams independently", () => {
  for (const [actorTeamId, accountTeamId] of [["t1", "t2"], ["t2", "t1"], [null, "t1"]]) {
    assert.deepEqual(checkProjectCreation({ ...pilot, actorTeamId }, { ...client, accountTeamId }), { error: PILOT_TEAM_PROJECT_ERROR });
    assert.deepEqual(checkProjectCreation({ ...pilot, actorTeamId }, { ...client, accountTeamId, isPurchaseOrderImport: true }), { ok: true, initialStatus: "ON_PROCESS" });
  }
  assert.deepEqual(checkProjectCreation(pilot, client), { ok: true, initialStatus: "BIDDING" });
  assert.deepEqual(checkProjectCreation({ ...pilot, actorTeamId: null }, { ...client, accountTeamId: null }), { ok: true, initialStatus: "BIDDING" });
});

test("creation UI mode follows flag and actor scope", () => {
  assert.equal(projectCreationMode(official), "RESTRICTED");
  assert.equal(projectCreationMode({ ...pilot, actorTeamId: "t1" }), "RESTRICTED");
  assert.equal(projectCreationMode(pilot), "LEGACY");
  assert.equal(projectCreationMode({ ...official, crmOn: false }), "LEGACY");
});

test("internal to client conversion uses the creation restriction", () => {
  const change = { from: "INTERNAL" as const, to: "CLIENT" as const, accountTeamId: "t2" };
  assert.deepEqual(checkProjectCategoryChange(official, change), { error: PROJECT_FROM_OPPORTUNITY_ERROR });
  assert.deepEqual(checkProjectCategoryChange(pilot, { ...change, accountTeamId: "t1" }), { error: PILOT_TEAM_PROJECT_ERROR });
  assert.deepEqual(checkProjectCategoryChange(pilot, change), { ok: true });
  assert.deepEqual(checkProjectCategoryChange(official, { ...change, from: "CLIENT", to: "INTERNAL" }), { ok: true });
  assert.deepEqual(checkProjectCategoryChange({ ...official, crmOn: false }, change), { ok: true });
});

test("status rules protect Opportunity provenance while permitting legacy Bidding closure", () => {
  const transition = { from: "ON_PROCESS", to: "BIDDING", hasSourceOpportunity: false };
  const denied = { error: STATUS_TRACKED_IN_OPPORTUNITY_ERROR };
  assert.deepEqual(checkProjectStatusChange(official, transition), denied);
  assert.deepEqual(checkProjectStatusChange(official, { ...transition, to: "FAIL" }), denied);
  assert.deepEqual(checkProjectStatusChange(official, { ...transition, from: "BIDDING", to: "FAIL" }), { ok: true });
  for (const to of ["BIDDING", "FAIL"]) {
    assert.deepEqual(checkProjectStatusChange(pilot, { ...transition, to, hasSourceOpportunity: true }), denied);
    assert.deepEqual(checkProjectStatusChange({ ...official, crmOn: false }, { ...transition, to, hasSourceOpportunity: true }), { ok: true });
    assert.deepEqual(checkProjectStatusChange(official, { ...transition, from: to, to, hasSourceOpportunity: true }), { ok: true });
    assert.deepEqual(checkProjectStatusChange(pilot, { ...transition, to }), { ok: true });
  }
  for (const to of ["ON_PROCESS", "DONE", "CANCEL", "PENDING"]) {
    assert.deepEqual(checkProjectStatusChange(official, { ...transition, to, hasSourceOpportunity: true }), { ok: true });
  }
});

test("status options retain original order and current legacy value, omit forbidden transitions", () => {
  const input = { current: "ON_PROCESS", hasSourceOpportunity: false, statusCounts: { BIDDING: 0, FAIL: 0 } };
  const keys = PROJECT_STATUSES.map(({ key }) => key);
  assert.deepEqual(visibleProjectStatusKeys(official, input), keys.filter((key) => key !== "BIDDING" && key !== "FAIL"));
  assert.deepEqual(visibleProjectStatusKeys(official, { ...input, current: "BIDDING", statusCounts: { BIDDING: 3, FAIL: 2 } }), keys);
  assert.deepEqual(visibleProjectStatusKeys(official, { ...input, current: "BIDDING" }), keys.filter((key) => key !== "FAIL"));
  assert.deepEqual(visibleProjectStatusKeys({ ...official, crmOn: false }, { ...input, hasSourceOpportunity: true }), keys);
  assert.deepEqual(visibleProjectStatusKeys(pilot, { ...input, hasSourceOpportunity: true }), keys.filter((key) => key !== "BIDDING" && key !== "FAIL"));
  assert.deepEqual(visibleProjectStatusKeys(pilot, input), keys);
});
