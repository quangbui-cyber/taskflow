import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("only active VAT applications contribute to AC payable projections", () => {
  const readModel = source("lib/costflow/actualCostReadModel.ts");
  const vendorService = source("lib/costflow/vendorPaymentService.ts");
  assert.match(readModel, /applications:\s*\{\s*some:\s*\{\s*state:\s*"ACTIVE"/);
  assert.match(vendorService, /applications:\s*\{\s*some:\s*\{\s*state:\s*"ACTIVE"/);
});

test("terminal payment decisions release VAT applications without deleting history", () => {
  const service = source("lib/costflow/service.ts");
  assert.match(service, /releaseVendorInvoiceApplications/);
  assert.match(service, /vendorInvoiceApplication\.updateMany[\s\S]*state:\s*"RELEASED"[\s\S]*releasedAt/);
  assert.match(service, /\["RETURNED", "REJECTED", "WITHDRAWN", "CANCELLED"\]/);
  assert.doesNotMatch(service, /vendorInvoice(?:Application|ActualCost)\.delete/);
});

test("settlement and export projections prefer one normalized identity", () => {
  const settlement = source("lib/costflow/settlementService.ts");
  const exportData = source("lib/costflow/exportData.ts");
  assert.match(settlement, /assertNormalizedSettlementSource/);
  assert.match(settlement, /legacy Expense/i);
  assert.match(exportData, /authoritativePaymentLines/);
  assert.match(exportData, /stableKey/);
});
