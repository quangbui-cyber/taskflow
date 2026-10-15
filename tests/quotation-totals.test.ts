import test from "node:test";
import assert from "node:assert/strict";
import { calculateCost } from "../lib/costflow/money";
import { calculateQuotationTotals, normalizeQuotationTotalLayout, normalizeQuotationTotals, type QuotationTotalLine } from "../lib/costflow/quotationTotals";
import { blankPairedRow } from "../lib/costflow/pairedDraft";
import { projectQuotation, projectSales } from "../lib/costflow/quotationProjection";
import { applyPairedCommand, savePairedDraft, finalizePairedQuotation, type PairedPersistence } from "../lib/costflow/pairedService";
import { emptyFinance } from "../lib/costflow/types";

function pairedStore(requestId = "ic-request"): PairedPersistence {
  return {
    findClientName: async () => "Customer",
    countProjectEvidence: async () => 0,
    createIcWorkflowRequest: async () => ({ id: requestId }),
    updateIcWorkflowRequest: async () => undefined,
  };
}

const items = calculateCost({ quantity: "1", unitPrice: "100.4", basis: "NET", vatPercent: "10" });
const fees: QuotationTotalLine[] = [
  { id: "management", label: "Phí quản lý", kind: "PERCENT", value: "5", vatPercent: "10", references: [{ source: "ITEMS", basis: "NET" }] },
  { id: "subtotal", label: "Tổng trung gian", kind: "SUBTOTAL", value: "", vatPercent: "", references: [{ source: "ITEMS", basis: "NET" }, { source: "management", basis: "NET" }] },
  { id: "extra", label: "Phí bổ sung", kind: "PERCENT", value: "10", vatPercent: "0", references: [{ source: "subtotal", basis: "NET" }] },
];
test("fee bases retain exact fractions and reordering does not change calculations or double count subtotals", () => {
  const result = calculateQuotationTotals(items, fees);
  assert.equal(result.amount.gross, "127");
  assert.equal(result.lines[0].amount?.rawNet, "251/50");
  assert.deepEqual(calculateQuotationTotals(items, [...fees].reverse()).amount, result.amount);
  assert.equal(result.incomplete, false);
});
test("system and custom total rows keep editable labels and one shared display order", () => {
  const layout = normalizeQuotationTotalLayout(fees, [
    { id: "SYSTEM_VAT", label: "Thuế GTGT" },
    { id: "management", label: "Phí quản lý hiển thị" },
    { id: "SYSTEM_NET", label: "Cộng trước thuế" },
  ]);
  assert.deepEqual(layout.map(row => row.id), ["SYSTEM_VAT", "management", "SYSTEM_NET", "subtotal", "extra", "SYSTEM_GROSS"]);
  assert.equal(layout[0].label, "Thuế GTGT");
  assert.equal(normalizeQuotationTotalLayout(fees, [...layout, layout[0]]).length, 6);
});
test("cycles, missing/deleted bases, duplicate references and negative fees are rejected", () => {
  assert.throws(() => normalizeQuotationTotals([{ ...fees[0], references: [{ source: "management", basis: "NET" }] }]), /vòng/);
  assert.throws(() => normalizeQuotationTotals([fees[2]]), /thiếu/);
  assert.throws(() => normalizeQuotationTotals([{ ...fees[0], references: [fees[0].references[0], fees[0].references[0]] }]), /trùng/);
  assert.throws(() => normalizeQuotationTotals([{ ...fees[0], value: "-5" }]), /âm/);
  assert.equal(calculateQuotationTotals(items, [{ ...fees[0], vatPercent: "" }]).incomplete, true);
});
test("customer quote projection includes fees and omits IC data", () => {
  const row = blankPairedRow("item"); row.name = "Item"; row.sell = { ...row.sell, quantity: "1", unitPrice: "100.4", vatPercent: "10" }; row.buy.notes = "PRIVATE_INTERNAL_SENTINEL";
  const projected = projectSales([row], "Quote", "Customer", "", fees);
  assert.equal(projected.amount.gross, "127");
  assert.equal(projected.totalLines?.length, 3);
  assert.ok(!JSON.stringify(projected).includes("PRIVATE_INTERNAL_SENTINEL"));
});
test("sales-only save leaves IC untouched; final quote freezes totals; IC mode cannot rewrite source sales", async () => {
  const data = emptyFinance();
  const tx = pairedStore();
  const row = blankPairedRow("item"); row.name = "Item"; row.sell = { ...row.sell, quantity: "1", unitPrice: "100.4", vatPercent: "10" };
  const form = new FormData(); form.set("workspaceMode", "quote"); form.set("rows", JSON.stringify([row])); form.set("title", "Quote"); form.set("clientId", "client"); form.set("totalLines", JSON.stringify(fees));
  const result = await savePairedDraft(tx, "project", "account", data, [], form);
  assert.equal(data.revisions.length, 0);
  const quoteId = finalizePairedQuotation(data, result.draftId, "account");
  assert.equal(projectQuotation(data.quotations![0]).amount.gross, "127");
  result.draft.totalLines![0].value = "20";
  assert.equal(data.quotations![0].totalLines![0].value, "5");
  const icForm = new FormData(); icForm.set("workspaceMode", "ic"); icForm.set("sourceQuotationId", quoteId); icForm.set("saveIc", "no"); icForm.set("clientId", "client"); icForm.set("rows", JSON.stringify([{ ...row, name: "FORGED", sell: { ...row.sell, unitPrice: "9999" } }]));
  const ic = await savePairedDraft(tx, "project", "account", data, [], icForm);
  assert.equal(ic.draft.rows[0].name, "Item"); assert.equal(ic.draft.rows[0].sell.unitPrice, "100.4");
  icForm.set("command", "FINALIZE_PAIRED_QUOTATION");
  await assert.rejects(savePairedDraft(tx, "project", "account", data, [], icForm), /không thay đổi/);
});

test("IC-only paired save persists buying fields without overwriting quotation fields", async () => {
  const data = emptyFinance();
  const requestId = "ic-request";
  const tx = pairedStore(requestId);
  const row = blankPairedRow("item");
  row.name = "Original quotation item";
  row.sell = { ...row.sell, quantity: "1", unitPrice: "100", vatPercent: "0" };
  row.buy = { ...row.buy, quantity: "1", unitPrice: "60", vatPercent: "0" };
  const both = new FormData();
  both.set("workspaceMode", "paired");
  both.set("saveScope", "BOTH");
  both.set("rows", JSON.stringify([row]));
  both.set("title", "Original title");
  both.set("clientId", "client");
  both.set("globalEvidenceIds", "[]");
  const first = await savePairedDraft(tx, "project", "account", data, [], both);

  const forged = structuredClone(first.draft.rows[0]);
  forged.name = "FORGED QUOTATION ITEM";
  forged.sell.unitPrice = "9999";
  forged.buy.unitPrice = "70";
  const icOnly = new FormData();
  icOnly.set("workspaceMode", "paired");
  icOnly.set("saveScope", "IC");
  icOnly.set("draftId", first.draftId);
  icOnly.set("rows", JSON.stringify([forged]));
  icOnly.set("title", "FORGED TITLE");
  icOnly.set("clientId", "forged-client");
  icOnly.set("globalEvidenceIds", "[]");
  const second = await savePairedDraft(tx, "project", "account", data, [{ id: requestId, state: "DRAFT", creatorId: "account" }], icOnly);

  assert.deepEqual(second.savedScopes, ["IC nháp"]);
  assert.equal(second.draft.title, "Original title");
  assert.equal(second.draft.clientId, "client");
  assert.equal(second.draft.rows[0].name, "Original quotation item");
  assert.equal(second.draft.rows[0].sell.unitPrice, "100");
  assert.equal(second.draft.rows[0].buy.unitPrice, "70");
});

test("paired finalize authority returns the immutable export seal plan from the same server-calculated quotation", async () => {
  const data = emptyFinance();
  const form = new FormData();
  const row = blankPairedRow("item");
  row.name = "Authoritative item";
  row.sell = { ...row.sell, quantity: "2", unitPrice: "100", vatPercent: "10" };
  form.set("command", "FINALIZE_PAIRED_QUOTATION");
  form.set("workspaceMode", "quote");
  form.set("rows", JSON.stringify([row]));
  form.set("title", "Authoritative quote");
  form.set("clientId", "client");
  const result = await applyPairedCommand(pairedStore(), "project", "account", data, [], form);
  assert.ok(result.quotationId);
  assert.equal(result.exportSeal?.sourceId, result.quotationId);
  assert.equal(result.exportSeal?.authoritativeTotals.gross, "220");
  assert.equal(result.exportSeal?.lines[0].rawGross, "220/1");
  assert.equal(data.quotations?.[0].id, result.quotationId);
});
