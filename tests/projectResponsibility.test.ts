import assert from "node:assert/strict";
import { test } from "node:test";
import { projectResponsibilityGroup, readProjectResponsibility, responsibilityValue } from "../lib/projectResponsibility";

const form = (value?: string) => {
  const data = new FormData();
  if (value !== undefined) data.set("responsibility", value);
  return data;
};

test("customer projects discard manual and stale assignments, including crafted values", () => {
  for (const value of [undefined, "", "group:creative", "team:other-sales", "invalid"]) {
    assert.deepEqual(readProjectResponsibility(form(value), {
      responsibleTeamId: null, responsibleGroupId: "creative",
    }, "CLIENT"), { responsibleTeamId: null, responsibleGroupId: null });
  }
});

test("customer grouping follows Account team changes and ignores legacy manual groups", () => {
  const project = {
    category: "CLIENT" as const,
    account: { team: { id: "sales-a", name: "Sales A" } },
    responsibleTeam: { id: "stale-sales", name: "Old Sales" },
    responsibleGroup: { id: "creative", name: "Creative" },
  };
  assert.deepEqual(projectResponsibilityGroup(project), { id: "team:sales-a", name: "Sales A" });
  assert.deepEqual(projectResponsibilityGroup({ ...project, account: { team: { id: "sales-b", name: "Sales B" } } }), { id: "team:sales-b", name: "Sales B" });
  assert.deepEqual(projectResponsibilityGroup({ ...project, account: null }), { id: "needs-account", name: "Cần gán Account" });
  assert.deepEqual(projectResponsibilityGroup({ ...project, category: "INTERNAL" }), { id: "group:creative", name: "Creative" });
});

test("switching between team and department clears the previous assignment", () => {
  const existing = { responsibleTeamId: "sales", responsibleGroupId: null };
  const department = readProjectResponsibility(form("group:creative"), existing);
  assert.deepEqual(department, { responsibleTeamId: null, responsibleGroupId: "creative" });
  assert.ok(!("error" in department));
  assert.deepEqual(readProjectResponsibility(form("team:operations"), department), {
    responsibleTeamId: "operations", responsibleGroupId: null,
  });
});

test("omitted fields preserve assignments; selecting unassigned clears them", () => {
  for (const existing of [
    { responsibleTeamId: "sales", responsibleGroupId: null },
    { responsibleTeamId: null, responsibleGroupId: "creative" },
  ]) {
    assert.deepEqual(readProjectResponsibility(form(), existing), existing);
    assert.deepEqual(readProjectResponsibility(form(""), existing), {
      responsibleTeamId: null, responsibleGroupId: null,
    });
    assert.deepEqual(readProjectResponsibility(form(responsibilityValue(existing))), existing);
  }
  assert.deepEqual(readProjectResponsibility(form()), {
    responsibleTeamId: null, responsibleGroupId: null,
  });
});

test("invalid kinds, empty ids and malformed assignment fields are rejected", () => {
  for (const value of ["creative", "user:creative", "team:", "group:", "team:a:group:b", "group: "]) {
    assert.ok("error" in readProjectResponsibility(form(value)), value);
  }
  const data = new FormData();
  data.set("responsibility", new Blob(["group:creative"]));
  assert.ok("error" in readProjectResponsibility(data));
});
