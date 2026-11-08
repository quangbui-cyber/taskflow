import assert from "node:assert/strict";
import test from "node:test";
import { groupProjectsForPicker } from "../lib/projectPickerGroups";

const projects = [
  { id: "1", name: "Jabil Pur", status: "DONE" },
  { id: "2", name: "Digitex YEP", status: "ON_PROCESS" },
  { id: "3", name: "ACBS - YEP", status: "BIDDING" },
  { id: "4", name: "Ánh Dương", status: "BIDDING" },
  { id: "5", name: "F88", status: "FAIL" },
  { id: "6", name: "Bảo Việt", status: "PENDING" },
  { id: "7", name: "Old", status: "ARCHIVED_LEGACY" },
];

test("Bidding and On Process are shown up front, in that order", () => {
  const { primary } = groupProjectsForPicker(projects);
  assert.deepEqual(primary.map((group) => group.status), ["BIDDING", "ON_PROCESS"]);
  assert.deepEqual(primary[0].projects.map((p) => p.name), ["ACBS - YEP", "Ánh Dương"]);
});

test("every other status goes into the collapsed group, none are lost", () => {
  const { others, otherCount } = groupProjectsForPicker(projects);
  assert.deepEqual(others.map((group) => group.status), ["PENDING", "DONE", "FAIL", "ARCHIVED_LEGACY"]);
  assert.equal(otherCount, 4);
});

test("empty groups are dropped", () => {
  const { primary, others, otherCount } = groupProjectsForPicker([{ id: "1", name: "A", status: "ON_PROCESS" }]);
  assert.deepEqual(primary.map((group) => group.status), ["ON_PROCESS"]);
  assert.equal(others.length, 0);
  assert.equal(otherCount, 0);
});

test("CRM owner groups follow project groups and preserve typed identities", () => {
  const grouped = groupProjectsForPicker(projects, {
    opportunities: [{ id: "same-id", name: "YEP 2027", clientName: "Bình Minh" }],
    clients: [{ id: "same-id", name: "Bình Minh" }, { id: "client-2", name: "An Bình" }],
  });
  assert.deepEqual(grouped.groups.slice(-2).map((group) => group.label), ["Cơ hội", "Khách hàng"]);
  assert.deepEqual(grouped.crm.map((group) => group.key), ["opportunities", "clients"]);
  assert.deepEqual(grouped.crm[0].items, [{ kind: "OPPORTUNITY", id: "same-id", label: "YEP 2027 · Bình Minh" }]);
  assert.equal(grouped.crm[1].items.length, 2);
  assert.equal(grouped.primary[0].items[0].kind, "PROJECT");
  assert.equal(grouped.crm[1].items.find((item) => item.id === "same-id")?.kind, "CLIENT");
});

test("empty CRM groups are omitted and CRM can be chosen without projects", () => {
  assert.equal(groupProjectsForPicker(projects).crm.length, 0);
  const grouped = groupProjectsForPicker([], { clients: [{ id: "client", name: "Client" }] });
  assert.deepEqual(grouped.groups.map((group) => group.key), ["clients"]);
  assert.equal(grouped.crm[0].items[0].kind, "CLIENT");
});
