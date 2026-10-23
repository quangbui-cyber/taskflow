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
