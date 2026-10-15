import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { blankPairedRow } from "../lib/costflow/pairedDraft";
import { selectPairedWorkspace } from "../lib/costflow/pairedReadModel";
import { emptyFinance, type FinanceData } from "../lib/costflow/types";

function source(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

test("paired route uses its focused loader without a JSON serialization round-trip", () => {
  const page = source("app/projects/[id]/costflow/paired/page.tsx");
  const loader = source("lib/costflow/pairedLoader.ts");

  assert.match(page, /loadPairedFinance/);
  assert.doesNotMatch(page, /loadFinance\s*\(/);
  assert.doesNotMatch(page, /JSON\.(?:parse|stringify)/);
  for (const unrelatedModel of ["costFlowCash", "customerLiquidation", "projectSettlement", "settlementCorrection"]) {
    assert.doesNotMatch(loader, new RegExp(unrelatedModel));
  }
});

test("paired projection drops unrelated finance domains and keeps only the selected editor lineage", () => {
  const data: FinanceData = emptyFinance();
  const row = blankPairedRow("row-1");
  data.quotations = [
    { id: "quote-1", number: 1, parentId: null, title: "Old", customer: "Client", notes: "", lines: [], poIds: [], evidenceIds: [], createdBy: "account", createdAt: "2026-10-01" },
    { id: "quote-2", number: 2, parentId: "quote-1", title: "Current", customer: "Client", notes: "", lines: [], salesRows: [row], poIds: [], evidenceIds: [], createdBy: "account", createdAt: "2026-10-02" },
  ];
  data.quotationDrafts = [
    { id: "draft-other", version: 1, createdBy: "other", workspaceMode: "paired", title: "Other", clientId: "client", customer: "Client", notes: "", rows: [row], sourceQuotationId: "quote-2", globalEvidenceIds: [] },
    { id: "draft-selected", version: 3, createdBy: "account", workspaceMode: "paired", title: "Selected", clientId: "client", customer: "Client", notes: "", rows: [row], sourceQuotationId: "quote-2", icRevisionId: "revision-2", globalEvidenceIds: [] },
  ];
  data.revisions = [
    { id: "revision-1", number: 1, requestId: "request-1", effective: true, lines: [], poIds: [], createdBy: "account" },
    { id: "revision-2", number: 2, requestId: "request-2", effective: false, quotationId: "quote-2", lines: [], poIds: [], createdBy: "account" },
  ];
  data.workingRevisionId = "revision-2";
  data.expenses = Array.from({ length: 200 }, (_, index) => ({ id: `expense-${index}` })) as FinanceData["expenses"];
  data.pos = Array.from({ length: 200 }, (_, index) => ({ id: `po-${index}` })) as FinanceData["pos"];

  const selected = selectPairedWorkspace(data, "account", { draftId: "draft-selected" });

  assert.ok(selected);
  assert.equal(selected.resolvedQuotationId, undefined);
  assert.deepEqual(selected.requestIds, ["request-2"]);
  assert.deepEqual(selected.data.quotationDrafts?.map(draft => draft.id), ["draft-selected"]);
  assert.deepEqual(selected.data.revisions.map(revision => revision.id), ["revision-2"]);
  assert.equal(selected.data.expenses.length, 0);
  assert.equal(selected.data.pos.length, 0);
  assert.equal(data.expenses.length, 200);
  assert.equal(data.quotationDrafts.length, 2);
});
