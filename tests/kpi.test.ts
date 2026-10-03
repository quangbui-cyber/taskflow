import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAllocateTeamKpi,
  canViewTeamKpi,
  kpiYearRange,
  parseMonthlyAmounts,
  progressPercent,
  splitEvenly,
  sumMonths,
  targetToDate,
  vietnamYearMonth,
} from "../lib/kpi";
import { formatAmountDraft, parseMillions } from "../components/KpiMonthGrid";

test("splitting a yearly target keeps the exact total", () => {
  for (const total of [0, 1, 1_000_000_000, 1_234_567_891]) {
    const months = splitEvenly(total);
    assert.equal(months.length, 12);
    assert.equal(sumMonths(months), total);
    assert.ok(Math.max(...months) - Math.min(...months) <= 1);
  }
});

test("monthly targets from the client must be 12 sane non-negative numbers", () => {
  const months = Array.from({ length: 12 }, () => 100);
  assert.deepEqual(parseMonthlyAmounts(months), months);
  assert.equal(parseMonthlyAmounts(months.slice(1)), null);
  assert.equal(parseMonthlyAmounts([...months.slice(1), -1]), null);
  assert.equal(parseMonthlyAmounts([...months.slice(1), Number.NaN]), null);
  assert.equal(parseMonthlyAmounts([...months.slice(1), "100"]), null);
  assert.equal(parseMonthlyAmounts([...months.slice(1), 1e15]), null);
  assert.equal(parseMonthlyAmounts("x"), null);
});

test("the KPI year follows Vietnam time, not UTC", () => {
  const { start, end } = kpiYearRange(2026);
  assert.equal(start.toISOString(), "2025-12-31T17:00:00.000Z");
  assert.equal(end.toISOString(), "2026-12-31T17:00:00.000Z");
  assert.deepEqual(vietnamYearMonth(start), { year: 2026, month: 1 });
  assert.deepEqual(vietnamYearMonth(new Date(end.getTime() - 1)), {
    year: 2026,
    month: 12,
  });
});

test("cumulative target counts months up to the current one", () => {
  const months = Array.from({ length: 12 }, () => 10);
  const now = new Date("2026-03-15T05:00:00Z");
  assert.equal(targetToDate(months, 2026, now), 30);
  assert.equal(targetToDate(months, 2025, now), 120);
  assert.equal(targetToDate(months, 2027, now), 0);
});

test("progress has no percentage without a target", () => {
  assert.equal(progressPercent(50, 0), null);
  assert.equal(progressPercent(50, 200), 25);
  assert.equal(progressPercent(300, 200), 150);
});

test("only admins and the team's own leader can split a team KPI", () => {
  const team = { leaderId: "acc-lead" };
  assert.ok(canAllocateTeamKpi({ role: "ADMIN", accountId: null }, team));
  assert.ok(canAllocateTeamKpi({ role: "ACCOUNT", accountId: "acc-lead" }, team));
  assert.equal(
    canAllocateTeamKpi({ role: "ACCOUNT", accountId: "acc-other" }, team),
    false
  );
  assert.equal(
    canAllocateTeamKpi({ role: "ACCOUNT", accountId: null }, { leaderId: null }),
    false
  );
  assert.equal(
    canAllocateTeamKpi({ role: "USER", accountId: "acc-lead" }, team),
    false
  );
});

test("accounts see only their own team", () => {
  const account = { role: "ACCOUNT", accountId: "a", teamId: "team-1" };
  assert.ok(canViewTeamKpi(account, "team-1"));
  assert.equal(canViewTeamKpi(account, "team-2"), false);
  assert.ok(canViewTeamKpi({ role: "ADMIN", accountId: null, teamId: null }, "team-2"));
  assert.equal(
    canViewTeamKpi({ role: "USER", accountId: null, teamId: "team-1" }, "team-1"),
    false
  );
});

test("amounts typed in millions accept Vietnamese separators", () => {
  assert.equal(parseMillions(""), 0);
  assert.equal(parseMillions("2000"), 2_000_000_000);
  assert.equal(parseMillions("2.000"), 2_000_000_000);
  assert.equal(parseMillions("1.200,5"), 1_200_500_000);
  assert.equal(parseMillions("700,5"), 700_500_000);
  assert.equal(parseMillions("1,5"), 1_500_000);
  assert.equal(parseMillions("-5"), null);
  assert.equal(parseMillions("abc"), null);
  assert.equal(parseMillions("1e3"), null);
});

test("typed amounts get thousand separators as the user types", () => {
  assert.equal(formatAmountDraft("3000"), "3.000");
  assert.equal(formatAmountDraft("3.0000"), "30.000");
  assert.equal(formatAmountDraft("1200000,5"), "1.200.000,5");
  assert.equal(formatAmountDraft("700,"), "700,");
  assert.equal(formatAmountDraft(",5"), "0,5");
  assert.equal(formatAmountDraft("007"), "7");
  assert.equal(formatAmountDraft("12a,34567"), "12,345");
  assert.equal(formatAmountDraft(""), "");
  assert.equal(parseMillions(formatAmountDraft("1200000,5")), 1_200_000_500_000);
});
