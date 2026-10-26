import assert from "node:assert/strict";
import test from "node:test";
import {
  costVat,
  formatMargin,
  sellAmount,
  sheetTotals,
  type CalcCostLine,
  type CalcSellLine,
} from "../lib/financeCalc";

const cost = (q: number | null, p: number | null, vat: number | null = 0.08): CalcCostLine => ({
  icQuantity: q,
  icUnitPrice: p,
  icVatRate: vat,
});
const sell = (q: number | null, p: number | null, costs: CalcCostLine[]): CalcSellLine => ({
  quantity: q,
  unitPrice: p,
  costs,
});

test("Jabil 3D Figures IC matches the Excel file", () => {
  // AC_JABIL FIGURE_22.09.2026.xlsx, khối BÁO GIÁ + INTERNAL COST
  const totals = sheetTotals(
    [
      {
        lines: [
          sell(68, 2_000_000, [
            cost(68, 1_429_738.56), // sản xuất tượng — ARTECH
            cost(68, 69_000), // sản xuất bục — Tân Hoàng Việt
            cost(1, null), // đổi mặt — IC để trống
          ]),
          sell(1, null, [cost(1, 1_000_000, null)]), // vận chuyển, không tính tiền khách
          sell(1, null, [cost(1, 500_000, null)]), // Project Leader
          sell(1, null, [cost(1, 500_000, null)]), // Supporter
        ],
      },
    ],
    0.08,
  );
  assert.equal(totals.sellSubtotal, 136_000_000);
  assert.equal(totals.sellVat, 10_880_000);
  assert.equal(totals.sellGross, 146_880_000);
  assert.equal(totals.costSubtotal, 103_914_222);
  assert.equal(totals.profit, 32_085_778);
  assert.equal(formatMargin(totals.margin), "23,6%");
});

test("Vietjet IC matches the Excel file, section by section", () => {
  // IC_VIETJET CHUYẾN BAY ĐỒNG HÀNH _1007.xlsx
  const totals = sheetTotals(
    [
      {
        lines: [
          sell(3, 500_000, [cost(3, 300_000)]),
          sell(1, 300_000, [cost(1, 150_000)]),
          sell(240, 22_000, [cost(240, 12_000)]),
          sell(4, 250_000, [cost(4, 150_000)]),
          sell(2, 550_000, [cost(2, 450_000)]),
          sell(6, 250_000, [cost(6, 150_000)]),
          sell(240, 10_000, [cost(240, 6_891)]),
        ],
      },
      {
        lines: [
          sell(1, 8_000_000, [cost(1, 5_000_000, null)]),
          sell(1, 5_000_000, [cost(1, 2_870_000)]),
          sell(1, 500_000, [cost(1, 28_000)]),
          sell(1, 14_000_000, [cost(1, 10_000_000)]),
        ],
      },
      { lines: [sell(1, 5_000_000, [cost(1, 3_000_000)])] },
    ],
    0.08,
  );
  assert.deepEqual(
    totals.sections.map((section) => [section.sell, section.cost]),
    [
      [13_080_000, 7_983_840],
      [27_500_000, 17_898_000],
      [5_000_000, 3_000_000],
    ],
  );
  assert.equal(totals.sellSubtotal, 45_580_000);
  assert.equal(totals.sellVat, 3_646_400);
  assert.equal(totals.sellGross, 49_226_400);
  assert.equal(totals.costSubtotal, 28_881_840);
  assert.equal(totals.profit, 16_698_160);
  assert.equal(formatMargin(totals.margin), "36,6%");
});

test("each line is rounded to the đồng before adding", () => {
  // Cover ly giấy: 240 × 6.891 = 1.653.840 → VAT 8% = 132.307,2 → 132.307
  assert.equal(costVat(cost(240, 6_891)), 132_307);
  // Giá bán nhập kiểu =2160000/1.08 không còn số lẻ khi đã lưu 2 chữ số thập phân
  assert.equal(sellAmount({ quantity: 68, unitPrice: 2_000_000 }), 136_000_000);
});

test("missing prices count as zero and margin is empty without sales", () => {
  const totals = sheetTotals([{ lines: [sell(null, null, [cost(null, 100)])] }], 0.08);
  assert.equal(totals.sellSubtotal, 0);
  assert.equal(totals.costSubtotal, 0);
  assert.equal(totals.margin, null);
  assert.equal(formatMargin(null), "—");
});
