import test from "node:test";
import { validateIcEvidence, IcEvidenceError, previewMime } from "../lib/costflow/icEvidence";
import assert from "node:assert/strict";
import { blankPairedRow, hydrateLegacyPairedDraft, normalizePairedRows, pairedFromLegacy } from "../lib/costflow/pairedDraft";
import { pricedTotal } from "../lib/costflow/pairedPricing";
import { projectSales, projectQuotation, quotationReadinessIssues } from "../lib/costflow/quotationProjection";
import { calculateCost, calculateLineCost } from "../lib/costflow/money";

test("line pricing multiplies quantity by days without changing generic cost inputs", () => {
  assert.equal(calculateLineCost({ quantity: "2", days: "3,5", unitPrice: "100", basis: "NET", vatPercent: "0" }).gross, "700");
  assert.equal(calculateCost({ quantity: "2", unitPrice: "100", basis: "NET", vatPercent: "0" }).gross, "200");
  assert.throws(() => calculateLineCost({ quantity: "2", days: "0", unitPrice: "100", basis: "NET", vatPercent: "0" }), /lớn hơn 0/);
});

test("legacy draft hydration defaults active lines only and does not rewrite the source", () => {
  const row = blankPairedRow("legacy");
  row.sell.days = "";
  row.buy = { ...row.buy, quantity: "2", unitPrice: "50", days: "" };
  const draft = { id: "draft", version: 1, createdBy: "account", title: "Legacy", clientId: "", customer: "Client", notes: "", rows: [row], globalEvidenceIds: [] };
  const snapshot = JSON.stringify(draft);
  const hydrated = hydrateLegacyPairedDraft(draft);
  assert.equal(hydrated.rows[0].sell.days, "1");
  assert.equal(hydrated.rows[0].buy.days, "1");
  assert.equal(JSON.stringify(draft), snapshot);
  row.buy.quantity = ""; row.buy.unitPrice = "";
  assert.equal(hydrateLegacyPairedDraft({ ...draft, rows: [row] }).rows[0].buy.days, "");
});
import { moveQuotationTree, quotationOutline } from "../lib/costflow/quotationHierarchy";

test("paired drafts preserve unknown versus zero and independent quantities", () => {
  const row = blankPairedRow("one"); row.sell.quantity = "3"; row.buy.quantity = "7"; row.buy.unitPrice = "0";
  assert.equal(row.sell.vatPercent, "8"); assert.equal(row.buy.vatPercent, "8");
  assert.equal(row.rowType, "ITEM"); assert.equal(row.showGroupSubtotal, true); assert.equal(row.packageChildDisplay, "CONTENT");
  const saved = normalizePairedRows([row])[0];
  assert.equal(saved.sell.unitPrice, ""); assert.equal(saved.buy.unitPrice, "0"); assert.equal(saved.buy.quantity, "7");
  assert.deepEqual(pairedFromLegacy(undefined, undefined), []);
  assert.throws(() => normalizePairedRows([row, row]), /trùng/);
  assert.throws(() => normalizePairedRows([{ ...row, parentItemId: "one" }]), /vòng/);
  assert.throws(() => normalizePairedRows([{ ...row, parentItemId: "foreign" }]), /Nhóm cha/);
});

test("legacy hierarchy gains explicit roles and document-style numbering", () => {
  const legacyGroup = blankPairedRow("group"), groupedItem = blankPairedRow("grouped", "group"), detail = blankPairedRow("detail", "grouped"), flat = blankPairedRow("flat");
  const legacy = [legacyGroup, groupedItem, detail, flat].map(row => {
    const value = structuredClone(row) as Partial<typeof row>;
    delete value.rowType; delete value.showGroupSubtotal; delete value.packageChildDisplay;
    return value;
  });
  const normalized = normalizePairedRows(legacy);
  assert.equal(normalized[0].rowType, "GROUP"); assert.equal(normalized[1].rowType, "ITEM");
  assert.deepEqual(quotationOutline(normalized).map(entry => [entry.row.itemId, entry.role, entry.numberLabel]), [
    ["group", "GROUP", "A"], ["grouped", "ITEM", "1"], ["detail", "DETAIL", ""], ["flat", "ITEM", "1"],
  ]);
  assert.throws(() => normalizePairedRows([{ ...blankPairedRow("parent"), rowType: "GROUP" }, { ...blankPairedRow("nested", "parent"), rowType: "GROUP" }]), /cấp gốc/);
});

test("tree moves preserve subtrees and reject nested groups or a fourth semantic level", () => {
  const groupA = blankPairedRow("group-a", null, "GROUP"), groupB = blankPairedRow("group-b", null, "GROUP");
  const item = blankPairedRow("item", "group-a"), detail = blankPairedRow("detail", "item"), other = blankPairedRow("other", "group-b");
  const moved = moveQuotationTree([groupA,item,detail,groupB,other], "item", "group-b", 1);
  assert.equal(moved.find(row => row.itemId === "item")?.parentItemId, "group-b");
  assert.equal(moved.find(row => row.itemId === "detail")?.parentItemId, "item");
  assert.throws(() => moveQuotationTree(moved,"group-a","group-b",0), /cấp gốc/);
  assert.throws(() => moveQuotationTree(moved,"item","other",0), /không thể chứa/);
  const promoted = moveQuotationTree(moved,"detail",null,0);
  assert.equal(promoted.find(row=>row.itemId==="detail")?.parentItemId,null);
});

test("package/detail contribution sets never double count and preserve inactive source prices", () => {
  const parent = blankPairedRow("parent"), one = blankPairedRow("one", "parent"), two = blankPairedRow("two", "parent");
  for (const row of [parent, one, two]) { row.name = row.itemId; row.sell.quantity = "1"; row.sell.vatPercent = "0"; row.buy.quantity = "1"; row.buy.days = "1"; row.buy.vatPercent = "0"; }
  parent.sell.unitPrice = "1000"; one.sell.unitPrice = "400"; two.sell.unitPrice = "700"; one.buy.unitPrice = "200"; two.buy.unitPrice = "300";
  parent.pricingMode = "PACKAGE";
  assert.equal(pricedTotal([parent, one, two], "sell").gross, "1000"); assert.equal(pricedTotal([parent, one, two], "buy").gross, "500");
  parent.pricingMode = "DETAIL"; assert.equal(pricedTotal([parent, one, two], "sell").gross, "1100"); assert.equal(parent.sell.unitPrice, "1000");
  const fractional = ["a", "b", "c"].map(id => { const row = blankPairedRow(id); row.sell = { ...row.sell, quantity: "1", unitPrice: "100.4", vatPercent: "0" }; return row; });
  assert.equal(pricedTotal(fractional, "sell").gross, "301");
  one.sell.vatPercent = "8"; two.sell.vatPercent = "10"; assert.equal(pricedTotal([parent, one, two], "sell").gross, "1202");
});

test("structural groups ignore their own dormant prices and expose optional subtotal", () => {
  const group = blankPairedRow("group",null,"GROUP"), item = blankPairedRow("item","group");
  group.sell = { ...group.sell, quantity:"1", unitPrice:"999", vatPercent:"0" };
  item.sell = { ...item.sell, quantity:"2", unitPrice:"100", vatPercent:"0" };
  assert.equal(pricedTotal([group,item],"sell").gross,"200");
  const projected = projectSales([group,item],"Quote","Client","");
  assert.equal(projected.rows[0].role,"GROUP"); assert.equal(projected.rows[0].numberLabel,"A"); assert.equal(projected.rows[0].amount?.net,"200");
  group.showGroupSubtotal = false;
  assert.equal(projectSales([group,item],"Quote","Client","").rows[0].showSubtotal,false);
});

test("customer allowlist and visibility share raw totals while hiding internal sentinels", () => {
  const parent = blankPairedRow("parent"), child = blankPairedRow("child", "parent"); parent.name = "Bundle"; child.name = "Public child";
  child.sell = { ...child.sell, quantity: "1", unitPrice: "100", vatPercent: "8", notes: "Public note" };
  child.sell.parameterBinding = { mode: "FORMULA", quantityFormula: { op: "CONST", value: "1" }, lastCalculated: { quantity: "FORMULA_PRIVATE" } };
  child.buy = { ...child.buy, unitPrice: "COST_PRIVATE", vendorId: "VENDOR_PRIVATE", notes: "IC_INTERNAL_NOTE", evidenceIds: ["EVIDENCE_PRIVATE"], parameterBinding: { mode: "OVERRIDDEN", quantityFormula: { op: "CONST", value: "1" }, lastCalculated: { quantity: "PARAM_PRIVATE" } } };
  parent.showChildren = false;
  const hidden = projectSales([parent, child], "Quote", "Client", "Note");
  assert.equal(hidden.rows.length, 1); assert.equal(hidden.amount.gross, "108");
  for (const token of ["FORMULA_PRIVATE", "PARAM_PRIVATE", "COST_PRIVATE", "VENDOR_PRIVATE", "EVIDENCE_PRIVATE", "IC_INTERNAL_NOTE", "Public child"]) assert.ok(!JSON.stringify(hidden).includes(token));
  parent.showChildren = true; const visible = projectSales([parent, child], "Quote", "Client", "Note");
  assert.equal(visible.rows.length, 2); assert.deepEqual(hidden.amount, visible.amount);
  parent.pricingMode = "PACKAGE"; parent.sell = { ...parent.sell, quantity: "1", unitPrice: "200", vatPercent: "0" };
  const bundle = projectSales([parent, child], "Quote", "Client", "Note"); assert.equal(bundle.rows[1].amount, null); assert.equal(bundle.rows[1].unitPrice, ""); assert.equal(bundle.amount.gross, "200");
  assert.equal(bundle.rows[1].unit, ""); assert.equal(bundle.rows[1].quantity, "");
  parent.packageChildDisplay = "QUANTITY";
  const quantified = projectSales([parent, child], "Quote", "Client", "Note"); assert.equal(quantified.rows[1].unit, child.sell.unit); assert.equal(quantified.rows[1].quantity, child.sell.quantity); assert.equal(quantified.rows[1].unitPrice, "");
});

test("legacy quotation projection keeps source immutable and ignores lineage as tree", () => {
  const line = { id: "legacy", parentQuotationLineId: "previous-version-id", description: "Legacy item", unit: "item", quantity: "2", days: "1", unitPrice: "12.3", basis: "NET" as const, vatPercent: "8", cost: calculateCost({ quantity: "2", unitPrice: "12.3", basis: "NET", vatPercent: "8" }) };
  const quote = { id: "old", number: 1, parentId: null, title: "Old", customer: "Client", notes: "", lines: [line], poIds: [], evidenceIds: ["PRIVATE_SOURCE"], createdBy: "account", createdAt: "2026-10-02" };
  const snapshot = JSON.stringify(quote), rows = pairedFromLegacy(quote, undefined);
  assert.equal(rows[0].parentItemId, null); assert.equal(rows[0].itemId, "legacy"); assert.equal(JSON.stringify(quote), snapshot);
  assert.equal(projectQuotation(quote).amount.gross, "27"); assert.ok(!JSON.stringify(projectQuotation(quote)).includes("PRIVATE_SOURCE"));
});
test("quotation readiness distinguishes missing values from valid zero amounts", () => {
  const row = blankPairedRow("one");
  assert.deepEqual(quotationReadinessIssues([], "", "" ).map(issue => issue.id), ["title", "customer", "rows"]);
  assert.ok(quotationReadinessIssues([row], "Quote", "Client").some(issue => issue.rowId === "one"));
  row.name = "Complimentary item";
  row.sell = { ...row.sell, quantity: "1", unitPrice: "0", vatPercent: "0" };
  const projected = projectSales([row], "Quote", "Client", "");
  assert.deepEqual(projected.issues, []);
  assert.equal(projected.incomplete, false);
  assert.equal(projected.amountIncomplete, false);
  assert.equal(projected.amount.gross, "0");
  assert.equal(projected.rows[0].days, "1");
  row.sell.days = "0";
  assert.match(quotationReadinessIssues([row], "Quote", "Client")[0].message, /lớn hơn 0/);
});
test("IC evidence gate uses actual line links or trimmed reason, never global coverage", () => {
  const line = { id: "cost-one", description: "Estimate", unit: "", quantity: "1", days: "1", unitPrice: "0", vatPercent: "0", basis: "NET" as const, cost: null };
  assert.throws(()=>validateIcEvidence([line]), e=>e instanceof IcEvidenceError && e.lineErrors[0].lineId === "cost-one");
  assert.throws(()=>validateIcEvidence([{...line,evidenceReason:"  \n "}]));
  validateIcEvidence([{...line,evidenceIds:["proof"]}]); validateIcEvidence([{...line,evidenceReason:"Awaiting supplier"}]);
  assert.equal(previewMime("image/png",Buffer.from("<script>")),null);
  assert.equal(previewMime("application/pdf",Buffer.from("%PDF-1.4")),"application/pdf");
});
