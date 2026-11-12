import assert from "node:assert/strict";
import { test } from "node:test";
import { boardDropIntent, budgetSpan, resolveOpportunityMode, timelineBuckets, type BoardCard } from "../lib/crm/opportunityList";

const card = (column: BoardCard["column"], rights = { canAdvance: true, canClose: true }, outcome: string | null = null) => ({ column, outcome, rights });

test("drop only names the existing dialog, one step forward at a time", () => {
  assert.deepEqual(boardDropIntent(card("CARE"), "CARE"), { kind: "NONE" });
  assert.deepEqual(boardDropIntent(card("CARE"), "BRIEF"), { kind: "BRIEF" });
  assert.deepEqual(boardDropIntent(card("BRIEF"), "BIDDING"), { kind: "BIDDING" });
  assert.deepEqual(boardDropIntent(card("BIDDING"), "WON"), { kind: "RESULT" });
  assert.deepEqual(boardDropIntent(card("BIDDING"), "ENDED"), { kind: "RESULT" });
  assert.deepEqual(boardDropIntent(card("CARE"), "ENDED"), { kind: "END" });
  assert.deepEqual(boardDropIntent(card("BRIEF"), "ENDED"), { kind: "END" });
  for (const [from, to] of [["CARE", "BIDDING"], ["CARE", "WON"], ["BRIEF", "WON"], ["BIDDING", "BRIEF"], ["BRIEF", "CARE"]] as const) assert.equal(boardDropIntent(card(from), to).kind, "ERROR", `${from}>${to}`);
});

test("drop respects rights and closed Opportunities", () => {
  assert.equal(boardDropIntent(card("CARE", { canAdvance: false, canClose: true }), "BRIEF").kind, "ERROR");
  assert.equal(boardDropIntent(card("BIDDING", { canAdvance: true, canClose: false }), "WON").kind, "ERROR");
  assert.equal(boardDropIntent(card("CARE", { canAdvance: true, canClose: false }), "ENDED").kind, "ERROR");
  assert.equal(boardDropIntent(card("WON", { canAdvance: true, canClose: true }, "WON"), "ENDED").kind, "ERROR");
});

test("budget span sums a range and ignores unpriced cards", () => {
  assert.equal(budgetSpan([{ budgetMin: null, budgetMax: null }]), null);
  assert.deepEqual(budgetSpan([{ budgetMin: 100, budgetMax: 200 }, { budgetMin: null, budgetMax: 50 }, { budgetMin: 30, budgetMax: null }, { budgetMin: null, budgetMax: null }]), { min: 180, max: 280 });
});

test("timeline groups by organization month, quarter, then year in order", () => {
  const c = (year: number, month: number | null, quarter: number | null) => ({ expected: { year, month, quarter } });
  const buckets = timelineBuckets([c(2027, 2, null), c(2026, null, 4), c(2026, 12, null), c(2026, null, null), c(2026, 10, null), c(2026, 12, null)]);
  assert.deepEqual(buckets.map(b => [b.label, b.cards.length]), [["T10/2026", 1], ["Quý 4/2026", 1], ["T12/2026", 2], ["Năm 2026, chưa rõ tháng", 1], ["T2/2027", 1]]);
});

test("legacy stage views open the list; modes come from the URL, then the cookie, then board", () => {
  assert.equal(resolveOpportunityMode({ view: "CLOSED" }, "u:board", "u"), "list");
  assert.equal(resolveOpportunityMode({ view: "timeline" }, undefined, "u"), "timeline");
  assert.equal(resolveOpportunityMode({}, "u:list", "u"), "list");
  assert.equal(resolveOpportunityMode({}, undefined, "u"), "board");
});
