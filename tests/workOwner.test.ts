import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerOf, ownerOrNull, ownerData, ownerWhere, ownerHref, ownerRevalidatePaths, ownerNotificationFields, parseOwnerInput } from "../lib/workOwner";

test("each of the three owners resolves and round-trips", () => {
  for (const kind of ["PROJECT", "OPPORTUNITY", "CLIENT"] as const) {
    const owner = { kind, id: "a b" };
    assert.deepEqual(ownerOf(ownerData(owner)), owner);
    assert.deepEqual(ownerNotificationFields(owner), ownerWhere(owner));
    assert.deepEqual(parseOwnerInput(kind, "a b"), owner);
    assert.ok(ownerRevalidatePaths(owner).includes("/tasks"));
    assert.ok(ownerHref(owner, "t ?").endsWith("a%20b?task=t%20%3F"));
  }
});
test("missing, multiple and invalid owners fail closed", () => {
  const none = { projectId: null, opportunityId: null, clientId: null };
  assert.throws(() => ownerOf(none));
  assert.equal(ownerOrNull(none), null);
  assert.throws(() => ownerOrNull({ ...none, projectId: "p", clientId: "c" }));
  assert.equal(parseOwnerInput("USER", "x"), null);
  assert.equal(parseOwnerInput("PROJECT", ""), null);
  assert.equal(parseOwnerInput("PROJECT", " "), null);
  assert.equal(parseOwnerInput("CLIENT", "x".repeat(65)), null);
  assert.equal(ownerHref({ kind: "OPPORTUNITY", id: "a b" }, "t1"), "/crm/opportunities/a%20b?task=t1");
  assert.deepEqual(ownerData({ kind: "CLIENT", id: "c" }), { projectId: null, opportunityId: null, clientId: "c" });
});
