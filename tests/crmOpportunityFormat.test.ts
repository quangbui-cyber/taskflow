import assert from "node:assert/strict";
import { test } from "node:test";
import { daysInStage, formatBudgetRange, formatCompactVnd, formatExpectedTiming, formatThousandsInput, parseThousandsInput } from "../lib/crm/opportunityFormat";

test("compact VND uses Vietnamese decimals and at most one decimal", () => {
  for (const [value, expected] of [[1_200_000_000, "1,2 tỷ"], [850_000_000, "850 triệu"], [1_000_000_000, "1 tỷ"], [0, "0"], [850_000, "850.000"], [1_234_000_000, "1,2 tỷ"]] as const) {
    assert.equal(formatCompactVnd(value), expected);
  }
});
test("budget range shares units only when both endpoints use the same unit", () => {
  assert.equal(formatBudgetRange(1_200_000_000, 1_500_000_000), "1,2 - 1,5 tỷ");
  assert.equal(formatBudgetRange(800_000_000, 1_200_000_000), "800 triệu - 1,2 tỷ");
  assert.equal(formatBudgetRange(null, 1_500_000_000), "Đến 1,5 tỷ");
  assert.equal(formatBudgetRange(1_200_000_000, null), "Từ 1,2 tỷ");
  assert.equal(formatBudgetRange(null, null), null);
  assert.equal(formatBudgetRange(0, 0), "0 - 0");
});
test("timing prefers month then quarter then year", () => {
  assert.equal(formatExpectedTiming({ expectedYear: 2026, expectedMonth: 11, expectedQuarter: null }), "11/2026");
  assert.equal(formatExpectedTiming({ expectedYear: 2026, expectedMonth: null, expectedQuarter: 4 }), "Q4/2026");
  assert.equal(formatExpectedTiming({ expectedYear: 2026, expectedMonth: null, expectedQuarter: null }), "2026");
});
test("stage age counts Vietnam calendar boundaries and clamps future dates", () => {
  assert.equal(daysInStage(new Date("2026-11-01T16:30:00Z"), new Date("2026-11-13T02:00:00Z")), 12);
  assert.equal(daysInStage(new Date("2026-11-01T16:59:00Z"), new Date("2026-11-01T17:01:00Z")), 1);
  assert.equal(daysInStage(new Date("2026-11-13T02:00:00Z"), new Date("2026-11-01T16:30:00Z")), 0);
});
test("thousands input groups digits and parsing rejects invalid or unsafe integers", () => {
  assert.equal(formatThousandsInput("1250000000"), "1.250.000.000");
  assert.equal(formatThousandsInput("1.2a5"), "125");
  assert.equal(formatThousandsInput("0007"), "7");
  assert.equal(formatThousandsInput(""), "");
  assert.equal(parseThousandsInput("1.250.000.000"), 1250000000);
  for (const value of ["", "abc", "1a2", "-1", "1e3", "1.25", "9.007.199.254.740.992"]) assert.equal(parseThousandsInput(value), null);
});
