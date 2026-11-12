import assert from "node:assert/strict";
import test from "node:test";
import { crmAccessFor, crmEnabled, parseCrmAccessUsers } from "../lib/features";

const on = (accessUserIds: string[] | null) => ({ enabled: true, accessUserIds });
const user = { id: "u1", role: "USER", isActive: true, deletedAt: null };
const admin = { id: "a1", role: "ADMIN", isActive: true, deletedAt: null };

test("flag off denies everyone, Admin included", () => {
  assert.equal(crmAccessFor(admin, { enabled: false, accessUserIds: ["a1"] }), false);
  assert.equal(crmAccessFor(user, { enabled: false, accessUserIds: ["u1"] }), false);
  assert.equal(crmEnabled({ NODE_ENV: "test" }), false);
});

test("Admin always has access while CRM is on, even with an empty or malformed list", () => {
  assert.equal(crmAccessFor(admin, on([])), true);
  assert.equal(crmAccessFor(admin, on(null)), true);
  assert.equal(crmAccessFor(admin, on(parseCrmAccessUsers("bad"))), true);
});

test("listed users have access; others do not; empty list means Admin only", () => {
  assert.equal(crmAccessFor(user, on(["u1"])), true);
  assert.equal(crmAccessFor(user, on(["u2"])), false);
  assert.equal(crmAccessFor(user, on([])), false);
  for (const role of ["ACCOUNT", "ACCOUNTANT", "USER"]) {
    assert.equal(crmAccessFor({ ...user, role }, on(["u1"])), true, role);
    assert.equal(crmAccessFor({ ...user, role }, on([])), false, role);
  }
  assert.equal(crmAccessFor(null, on(["u1"])), false);
  assert.equal(crmAccessFor({ ...user, id: "" }, on([""])), false);
});

test("disabled or deleted users are ignored even when listed, Admin included", () => {
  assert.equal(crmAccessFor({ ...user, isActive: false }, on(["u1"])), false);
  assert.equal(crmAccessFor({ ...user, deletedAt: new Date() }, on(["u1"])), false);
  assert.equal(crmAccessFor({ ...admin, isActive: false }, on([])), false);
});

test("parser is strict: malformed settings read as null", () => {
  assert.deepEqual(parseCrmAccessUsers([]), []);
  assert.deepEqual(parseCrmAccessUsers(["u1", "u2"]), ["u1", "u2"]);
  for (const bad of [null, undefined, "u1", 1, {}, { users: ["u1"] }, [1], [""], ["  "], [" u1"], ["u1", "u1"], ["x".repeat(65)], Array.from({ length: 501 }, (_, i) => `u${i}`)]) {
    assert.equal(parseCrmAccessUsers(bad), null, JSON.stringify(bad)?.slice(0, 40));
  }
  assert.equal(crmAccessFor(user, on(parseCrmAccessUsers({ users: ["u1"] }))), false);
});
