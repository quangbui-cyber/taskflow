import assert from "node:assert/strict";
import { test } from "node:test";
import { assessPersonaDepth, emptyPersonaDepth, parsePersonaDepth, personaDepthConfigured } from "../lib/crm/personaDepth";

test("persona depth distinguishes pending tiers from an explicit choice of no requirements", () => {
  const pending = emptyPersonaDepth();
  assert.deepEqual({ ...pending }, { S: null, A: null, B: null, C: null, UNRATED: null });
  assert.equal(personaDepthConfigured(pending), false);
  for (const tier of ["S", "A", "B", "C", "UNRATED"] as const) {
    assert.equal(assessPersonaDepth(pending, tier, {}).status, "NOT_CONFIGURED");
    pending[tier] = [];
    assert.equal(assessPersonaDepth(pending, tier, {}).status, "NO_REQUIREMENTS");
  }
  assert.equal(personaDepthConfigured(pending), true);
  assert.deepEqual(emptyPersonaDepth().S, null, "defaults must not share mutable rows");
});

test("persona depth parser rejects missing tiers, unknown fields, duplicates and malformed rows", () => {
  const policy = { ...emptyPersonaDepth(), S: ["valuedMost", "budgetSeason"] };
  assert.deepEqual(parsePersonaDepth(policy)?.S, ["budgetSeason", "valuedMost"]);
  for (const value of [null, [], {}, { ...policy, extra: [] }, { ...policy, S: "budgetSeason" },
    { ...policy, A: ["industry"] }, { ...policy, B: ["vendorSelection", "vendorSelection"] },
    { ...policy, UNRATED: [null] }, { ...policy, C: ["__proto__"] }]) {
    assert.equal(parsePersonaDepth(value), null);
  }
});

test("persona depth checks persisted fields without treating zero, blank text or invalid months as complete", () => {
  const policy = { ...emptyPersonaDepth(), S: ["budgetSeason", "budgetSeasonMonth", "vendorSelection", "valuedMost"] as const };
  const parsed = parsePersonaDepth(policy)!;
  const partial = { budgetSeason: "  ", budgetSeasonMonth: 0, vendorSelection: "Chào thầu", valuedMost: null };
  assert.deepEqual(assessPersonaDepth(parsed, "S", partial), {
    status: "INCOMPLETE", expected: ["budgetSeason", "budgetSeasonMonth", "vendorSelection", "valuedMost"],
    missing: ["budgetSeason", "budgetSeasonMonth", "valuedMost"],
  });
  for (const month of [null, 0, 13, 1.5]) assert.ok(assessPersonaDepth(parsed, "S", { ...partial, budgetSeasonMonth: month }).missing.includes("budgetSeasonMonth"));
  const complete = { budgetSeason: "Quý 4", budgetSeasonMonth: 10, vendorSelection: "Chào thầu", valuedMost: "Chất lượng" };
  assert.equal(assessPersonaDepth(parsed, "S", complete).status, "COMPLETE");
  assert.equal(assessPersonaDepth(parsed, "A", complete).status, "NOT_CONFIGURED");
  assert.equal(assessPersonaDepth({ ...parsed, A: ["valuedMost"] }, "A", partial).status, "INCOMPLETE");
  assert.equal(assessPersonaDepth({ ...parsed, A: [] }, "A", partial).status, "NO_REQUIREMENTS");
});
