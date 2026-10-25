import assert from "node:assert/strict";
import test from "node:test";
import {
  collectInputIds,
  collectSupplierIds,
  readFinanceSheetInput,
} from "../lib/financeSheetInput";
import {
  canEditFinanceSheet,
  canViewFinanceSell,
  isFinanceSheetLocked,
} from "../lib/financePolicy";

const header = {
  clientName: " Jabil  Vietnam ",
  programName: "3D Figures",
  headcount: "",
  location: "",
  eventStart: "2026-09-22",
  eventEnd: "",
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    header,
    sellVatRate: 0.08,
    sections: [
      {
        id: "sec1",
        name: "I. SẢN XUẤT",
        lines: [
          {
            id: "line1",
            stt: "1",
            name: "Tượng 3D quà tặng",
            quantity: 68,
            unitPrice: 2_000_000,
            costs: [
              { id: "cost1", description: "Sản xuất tượng", icQuantity: 68, icUnitPrice: 1_429_738.5588, icVatRate: 0.08, icSupplierId: "supA" },
              { description: "Sản xuất bục", icQuantity: 68, icUnitPrice: 69_000, icVatRate: 0.08, icSupplierId: "supB" },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

test("a valid sheet is cleaned and money is kept to 2 decimals", () => {
  const input = readFinanceSheetInput(payload());
  assert.ok(!("error" in input));
  assert.equal(input.header.clientName, "Jabil Vietnam");
  assert.equal(input.header.headcount, null);
  assert.equal(input.sections[0].lines[0].costs[0].icUnitPrice, 1_429_738.56);
  assert.equal(input.sections[0].lines[0].costs[1].id, undefined);
  assert.deepEqual(collectSupplierIds(input).sort(), ["supA", "supB"]);
  const ids = collectInputIds(input);
  assert.deepEqual([...ids.sections, ...ids.lines, ...ids.costs], ["sec1", "line1", "cost1"]);
});

test("lines and sections need a name", () => {
  const noName = payload({
    sections: [{ name: "I", lines: [{ name: "  ", costs: [] }] }],
  });
  const result = readFinanceSheetInput(noName);
  assert.ok("error" in result);
  assert.match(result.error, /chưa có tên/);
  assert.ok("error" in readFinanceSheetInput(payload({ sections: [{ name: "", lines: [] }] })));
});

test("negative, non-numeric and absurd amounts are rejected", () => {
  for (const bad of [-1, "100", Number.NaN, 1e20]) {
    const result = readFinanceSheetInput(
      payload({ sections: [{ name: "I", lines: [{ name: "A", unitPrice: bad, costs: [] }] }] }),
    );
    assert.ok("error" in result, String(bad));
  }
});

test("VAT above 20% and malformed ids are rejected", () => {
  assert.ok("error" in readFinanceSheetInput(payload({ sellVatRate: 0.5 })));
  const badId = payload({ sections: [{ id: "x y;drop", name: "I", lines: [] }] });
  assert.ok("error" in readFinanceSheetInput(badId));
});

test("empty prices mean no price, not zero", () => {
  const input = readFinanceSheetInput(
    payload({ sections: [{ name: "I", lines: [{ name: "Vận chuyển", unitPrice: null, quantity: 1, costs: [] }] }] }),
  );
  assert.ok(!("error" in input));
  assert.equal(input.sections[0].lines[0].unitPrice, null);
});

test("bad header dates are reported", () => {
  const result = readFinanceSheetInput(payload({ header: { ...header, eventEnd: "2026-09-01" } }));
  assert.ok("error" in result);
});

test("who can see and edit the finance sheet", () => {
  assert.equal(canViewFinanceSell("USER"), false);
  assert.equal(canViewFinanceSell("ACCOUNTANT"), true);
  assert.equal(canEditFinanceSheet("ACCOUNT"), true);
  assert.equal(canEditFinanceSheet("ACCOUNTANT"), false);
  assert.equal(canEditFinanceSheet("USER"), false);
  assert.equal(isFinanceSheetLocked("DRAFT"), false);
  assert.equal(isFinanceSheetLocked("REJECTED"), false);
  assert.equal(isFinanceSheetLocked("SUBMITTED"), true);
  assert.equal(isFinanceSheetLocked("APPROVED"), true);
});
