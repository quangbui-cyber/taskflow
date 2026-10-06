import test from "node:test";
import assert from "node:assert/strict";
import { TEAMBUILDING_TEMPLATE_DESCRIPTION, TEAMBUILDING_TEMPLATE_NAME, TEAMBUILDING_TEMPLATE_SNAPSHOT } from "../prisma/quotationTemplateSeeds";
import { normalizePairedRows } from "../lib/costflow/pairedDraft";
import { groupAmount } from "../lib/costflow/pairedPricing";
import { evaluateFormula, normalizeParameterSnapshot } from "../lib/costflow/quotationParameters";

test("Teambuilding quotation template preserves hierarchy, source quantities and billable day multiplication", () => {
  const rows = normalizePairedRows(TEAMBUILDING_TEMPLATE_SNAPSHOT.rows);
  assert.equal(TEAMBUILDING_TEMPLATE_NAME, "Báo giá mẫu — Teambuilding");
  assert.match(TEAMBUILDING_TEMPLATE_DESCRIPTION, /Loại project: Teambuilding/);
  assert.match(TEAMBUILDING_TEMPLATE_SNAPSHOT.notes, /LOẠI PROJECT: TEAMBUILDING/);
  assert.equal(rows.length, 42);
  assert.equal(rows.filter(row => row.rowType === "GROUP").length, 7);
  const parameterConfig = normalizeParameterSnapshot(TEAMBUILDING_TEMPLATE_SNAPSHOT.parameterConfig);
  assert.deepEqual(parameterConfig.sharedValues, { participants: "85", days: "2", nights: "1", rooms: "43" });
  assert.equal(parameterConfig.modules.length, 7);

  const projectLeader = rows.find(row => row.itemId === "tb-f-1")!;
  assert.equal(projectLeader.sell.quantity, "2");
  assert.equal(evaluateFormula(projectLeader.sell.parameterBinding!.quantityFormula!, parameterConfig, projectLeader.sell.parameterBinding!.moduleId).value, "2");
  assert.match(projectLeader.sell.notes, /SL gốc: 1; Số ngày: 2/);
  const supporter = rows.find(row => row.itemId === "tb-f-2")!;
  assert.equal(supporter.sell.quantity, "4");
  const insurance = rows.find(row => row.itemId === "tb-g-3")!;
  assert.equal(insurance.sell.quantity, "170");
  assert.equal(evaluateFormula(insurance.sell.parameterBinding!.quantityFormula!, parameterConfig, insurance.sell.parameterBinding!.moduleId).value, "170");
  assert.ok(rows.every(row => row.buy.parameterBinding === undefined));

  const idea = rows.find(row => row.itemId === "tb-a-1")!;
  assert.equal(idea.sell.unitPrice, "0");
  assert.match(idea.sell.notes, /FOC; đơn giá tham chiếu 3\.000\.000 VND/);
  const optionalChair = rows.find(row => row.itemId === "tb-d-6-1")!;
  assert.equal(optionalChair.sell.quantity, "");
  assert.equal(optionalChair.sell.unitPrice, "50000");
  assert.match(optionalChair.sell.notes, /Optional/);
  assert.match(optionalChair.sell.notes, /SL gốc: 85/);
  const gift = rows.find(row => row.itemId === "tb-g-5")!;
  assert.equal(gift.sell.unitPrice, "0");
  assert.match(gift.sell.notes, /Ga tặng/);

  const staff = rows.find(row => row.itemId === "tb-f")!;
  assert.equal(groupAmount(rows, staff, "sell")?.net, "41400000");
  assert.equal(rows.find(row => row.itemId === "tb-c-7-1")?.parentItemId, "tb-c-7");
  assert.equal(rows.find(row => row.itemId === "tb-d-6-2")?.parentItemId, "tb-d-6");
});
