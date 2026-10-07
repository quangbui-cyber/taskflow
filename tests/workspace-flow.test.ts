import test from "node:test";
import assert from "node:assert/strict";
import { WORKSPACE_CAPABILITIES, newerQuotation, quotationVersionDate, requestStateLabel, rowCompletion, workspaceSaveLabel } from "../lib/costflow/workspaceFlow";
import type { Quotation } from "../lib/costflow/types";
import { blankPairedRow } from "../lib/costflow/pairedDraft";
import { createPairedFromQuoteDraft } from "../lib/costflow/pairedService";
import { emptyFinance } from "../lib/costflow/types";

const quotation = (id: string, number: number): Quotation => ({
  id,
  number,
  parentId: null,
  title: `BG ${number}`,
  customer: "Client",
  notes: "",
  lines: [],
  poIds: [],
  evidenceIds: [],
  createdBy: "account",
  createdAt: `2026-10-0${number}`,
});

test("workspace capabilities keep sales, buying and hierarchy boundaries explicit", () => {
  assert.equal(WORKSPACE_CAPABILITIES.quote.editSales, true);
  assert.equal(WORKSPACE_CAPABILITIES.quote.editBuying, false);
  assert.equal(WORKSPACE_CAPABILITIES.paired.editHierarchy, true);
  assert.equal(WORKSPACE_CAPABILITIES.ic.editHierarchy, false);
  assert.equal(WORKSPACE_CAPABILITIES.ic.finalizeQuotation, false);
});

test("save labels name the record scope instead of using an ambiguous generic draft label", () => {
  assert.equal(workspaceSaveLabel("quote", false), "Chỉ lưu Báo giá");
  assert.equal(workspaceSaveLabel("paired", true), "Lưu Báo giá & IC");
  assert.equal(workspaceSaveLabel("paired", false), "Chỉ lưu Báo giá");
  assert.equal(workspaceSaveLabel("ic", true), "Lưu nháp IC");
});

test("lineage helpers expose newer quotation versions without changing the IC source", () => {
  const first = quotation("one", 1), second = quotation("two", 2);
  assert.equal(newerQuotation(first, [first, second])?.id, "two");
  assert.equal(newerQuotation(second, [first, second]), undefined);
  assert.equal(requestStateLabel("SUBMITTED"), "Chờ duyệt");
  assert.equal(quotationVersionDate(first), "1/10/2026");
});

test("row completion separates customer and internal readiness without treating zero as blank", () => {
  const row = blankPairedRow("complete");
  row.name = "Production";
  row.sell = { ...row.sell, unit: "gói", quantity: "1", unitPrice: "0", vatPercent: "0" };
  row.buy = { ...row.buy, unit: "gói", quantity: "1", unitPrice: "80", vatPercent: "8", evidenceReason: "Đang chờ báo giá NCC" };
  assert.deepEqual(rowCompletion(row), { sell: { complete: 5, total: 5 }, buy: { complete: 6, total: 6 } });
});

test("quote drafts open as separate paired drafts without copying internal cost", () => {
  const data = emptyFinance();
  const row = blankPairedRow("item");
  row.name = "Production";
  row.sell.unitPrice = "100";
  row.buy.unitPrice = "PRIVATE_COST";
  data.quotationDrafts = [{ id: "quote-draft", version: 2, createdBy: "account", workspaceMode: "quote", title: "Quote", clientId: "client", customer: "Client", notes: "", rows: [row], globalEvidenceIds: [] }];
  const paired = createPairedFromQuoteDraft(data, "quote-draft", "account");
  assert.equal(paired.workspaceMode, "paired");
  assert.equal(paired.sourceQuoteDraftId, "quote-draft");
  assert.equal(paired.rows[0].sell.unitPrice, "100");
  assert.equal(paired.rows[0].buy.unitPrice, "");
  assert.equal(createPairedFromQuoteDraft(data, "quote-draft", "account").id, paired.id);
});
