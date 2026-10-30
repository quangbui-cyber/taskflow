import test from "node:test";
import assert from "node:assert/strict";
import { buildLeaderboard, isMonthKey, monthKeyOf, monthLabel, monthRange, shiftMonth } from "../lib/sudokuLeaderboard";

test("leaderboard: month boundaries follow Vietnam time", () => {
  // 31/10 23:30 giờ VN = 31/10 16:30 UTC → vẫn là tháng 10.
  assert.equal(monthKeyOf(new Date("2026-10-31T16:30:00Z")), "2026-10");
  // 01/11 00:30 giờ VN = 31/10 17:30 UTC → đã sang tháng 11.
  assert.equal(monthKeyOf(new Date("2026-10-31T17:30:00Z")), "2026-11");

  const { start, end } = monthRange("2026-10");
  assert.equal(start.toISOString(), "2026-09-30T17:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-31T17:00:00.000Z");
});

test("leaderboard: month helpers", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(monthLabel("2026-03"), "Tháng 3/2026");
  assert.ok(isMonthKey("2026-10"));
  assert.ok(!isMonthKey("2026-13"));
  assert.ok(!isMonthKey("abc"));
});

test("leaderboard: ranks by wins, then fewer games, ties share rank", () => {
  const rows = buildLeaderboard([
    { hostUserId: "a", guestUserId: "b", winnerUserId: "a" },
    { hostUserId: "a", guestUserId: "b", winnerUserId: "a" },
    { hostUserId: "c", guestUserId: "b", winnerUserId: "c" },
    { hostUserId: "c", guestUserId: "d", winnerUserId: "c" },
    { hostUserId: "c", guestUserId: "a", winnerUserId: "a" },
    { hostUserId: "d", guestUserId: "b", winnerUserId: null },
  ]);
  const byId = Object.fromEntries(rows.map((r) => [r.userId, r]));

  assert.deepEqual(
    rows.map((r) => r.userId),
    ["a", "c", "d", "b"]
  );
  assert.equal(byId.a.wins, 3);
  assert.equal(byId.a.played, 3);
  assert.equal(byId.a.winRate, 100);
  assert.equal(byId.c.wins, 2);
  assert.equal(byId.c.losses, 1);
  assert.equal(byId.d.draws, 1);
  assert.equal(byId.b.played, 4);
  assert.equal(byId.b.wins, 0);
  // d (0 thắng, 2 trận) đứng trên b (0 thắng, 4 trận).
  assert.deepEqual(
    rows.map((r) => r.rank),
    [1, 2, 3, 4]
  );
});

test("leaderboard: identical records share a rank", () => {
  const rows = buildLeaderboard([
    { hostUserId: "a", guestUserId: "b", winnerUserId: "a" },
    { hostUserId: "c", guestUserId: "d", winnerUserId: "c" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.rank),
    [1, 1, 3, 3]
  );
});
