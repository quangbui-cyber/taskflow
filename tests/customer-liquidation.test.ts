import test from "node:test";
import assert from "node:assert/strict";
import { deriveCustomerAccounting, validateLiquidationAmounts } from "../lib/costflow/customerAccounting";

const cost = (net: string) => ({ rawNet: `${net}/1`, rawVat: "0/1", rawGross: `${net}/1`, net, vat: "0", gross: net });
const liquidation = (version: number, netAmount: string, vatAmount: string, grossAmount: string) => ({
  id: `liquidation-${version}`,
  version,
  documentNumber: `TL-${version}`,
  signedAt: "2026-10-09T00:00:00.000Z",
  netAmount,
  vatAmount,
  grossAmount,
  evidence: { id: `evidence-${version}`, name: `tl-${version}.pdf`, sha256: `hash-${version}` },
  createdAt: "2026-10-09T00:00:00.000Z",
});

test("customer accounting: liquidation values are canonical exact VND", () => {
  assert.deepEqual(validateLiquidationAmounts({ netAmount: "100000000", vatAmount: "10000000", grossAmount: "110000000" }), { netAmount: "100000000", vatAmount: "10000000", grossAmount: "110000000" });
  assert.throws(() => validateLiquidationAmounts({ netAmount: "100000000", vatAmount: "10000000", grossAmount: "999999999" }), /net.*VAT|tổng/i);
  assert.throws(() => validateLiquidationAmounts({ netAmount: "100.5", vatAmount: "10", grossAmount: "110.5" }), /VND/i);
  assert.throws(() => validateLiquidationAmounts({ netAmount: "-1", vatAmount: "0", grossAmount: "-1" }), /VND/i);
});

test("customer accounting: signed liquidation net wins, AR stays separate and normalized rows prevent legacy double count", () => {
  const result = deriveCustomerAccounting({
    liquidations: [liquidation(1, "100000000", "10000000", "110000000"), liquidation(2, "120000000", "12000000", "132000000")],
    cashIns: [{ id: "cash-1", liquidationId: "liquidation-2", milestone: "Đợt 2", occurredAt: "2026-10-09T00:00:00.000Z", amount: "50000000", reference: "AR-1", evidence: null, createdAt: "2026-10-09T00:00:00.000Z" }],
    quotation: { net: "150000000", gross: "165000000" },
    purchaseOrderNet: "140000000",
    actualCosts: [
      { stableLineId: "same", source: "legacy", cost: cost("99999999") },
      { stableLineId: "same", source: "normalized", cost: cost("70000000") },
      { stableLineId: "legacy-only", source: "legacy", cost: cost("10000000") },
    ],
  });
  assert.equal(result.margin.source, "SIGNED_LIQUIDATION_NET");
  assert.equal(result.margin.revenueNet, "120000000");
  assert.equal(result.margin.incurredNet, "80000000");
  assert.equal(result.margin.netMargin, "40000000");
  assert.equal(result.margin.percent, "33.33");
  assert.equal(result.margin.legacyCompatibility, true);
  assert.deepEqual(result.receivable, { source: "LIQUIDATION_GROSS", targetGross: "132000000", collectedGross: "50000000", outstandingGross: "82000000" });
  assert.equal(result.currentLiquidation?.version, 2);
  assert.equal(result.liquidations.length, 2);
});

test("customer accounting: finalized quotation then PO are explicit fallbacks and zero revenue has no percentage", () => {
  const quotation = deriveCustomerAccounting({ liquidations: [], cashIns: [], quotation: { net: "90000000", gross: "99000000" }, purchaseOrderNet: "80000000", actualCosts: [{ stableLineId: "ac", source: "normalized", cost: cost("30000000") }] });
  assert.equal(quotation.margin.source, "FINALIZED_QUOTATION_NET");
  assert.equal(quotation.margin.netMargin, "60000000");
  assert.equal(quotation.receivable.source, "QUOTATION_GROSS");
  const po = deriveCustomerAccounting({ liquidations: [], cashIns: [], quotation: null, purchaseOrderNet: "80000000", actualCosts: [] });
  assert.equal(po.margin.source, "CURRENT_PO_NET");
  assert.equal(po.receivable.source, "PO_NET_FALLBACK");
  const empty = deriveCustomerAccounting({ liquidations: [], cashIns: [], quotation: null, purchaseOrderNet: "0", actualCosts: [] });
  assert.equal(empty.margin.percent, null);
  assert.equal(empty.margin.source, "NO_REVENUE_SOURCE");
});
