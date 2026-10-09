import test from "node:test";
import assert from "node:assert/strict";
import { currentPurchaseOrders, resolvePurchaseOrderHistory } from "../lib/costflow/budgetSources";
import { emptyFinance, type PurchaseOrder } from "../lib/costflow/types";
import { margin } from "../lib/costflow/reconciliation";
import { draftLineIssues, completeIcLines } from "../lib/costflow/budgetDraft";
import { calculateCost, decimal, round, totals } from "../lib/costflow/money";
import { diffIcRevisions, workingIcRevision } from "../lib/costflow/budgetRevisions";
import type { IcRevision } from "../lib/costflow/types";
import { resolveIcLineOrigin, validateIcLineOrigins } from "../lib/costflow/budgetLineage";

test("Line ancestry resolves archived draft sources and rejects foreign, duplicate and cyclic links", () => {
  const old = { id: "old", description: "Original", unit: "set", quantity: "1", days: "1", unitPrice: "", vatPercent: "", basis: "NET" as const, cost: null };
  const data = { ...emptyFinance(), lineArchive: [{ revisionId: "r", line: old }] };
  const next = { ...old, id: "new", originLines: [{ revisionId: "r", lineId: "old" }] };
  validateIcLineOrigins(data, next, "r");
  assert.equal(resolveIcLineOrigin(data, "r", "old")?.description, "Original");
  assert.throws(() => validateIcLineOrigins(data, { ...next, originLines: [{ revisionId: "foreign", lineId: "old" }] }, "r"));
  assert.throws(() => validateIcLineOrigins(data, { ...next, originLines: [...next.originLines, ...next.originLines] }, "r"));
  assert.throws(() => validateIcLineOrigins(data, { ...next, originLines: [{ revisionId: "r", lineId: "new" }] }, "r"));
});

test("All business fields and sources are material, internal notes exempt, pending effective revision remains working", () => {
  const base: IcRevision = { id: "r", number: 1, requestId: "q", createdBy: "a", effective: true, poIds: [], lines: [{ id: "l", description: "Print", unit: "set", quantity: "1", days: "1", unitPrice: "100", basis: "NET", vatPercent: "0", cost: calculateCost({ quantity: "1", unitPrice: "100", basis: "NET", vatPercent: "0" }) }] };
  for (const key of ["description", "unit", "quantity", "days", "unitPrice", "vatPercent", "quotationId", "quotationLineId", "vendorId"] ) {
    const changed = structuredClone(base); Object.assign(changed.lines[0], { [key]: "different" });
    assert.equal(diffIcRevisions(changed, base).material, true, key);
  }
  const changed = structuredClone(base); changed.lines[0].basis = "GROSS";
  assert.equal(diffIcRevisions(changed, base).material, true);
  assert.equal(diffIcRevisions({ ...base, internalNotes: "note" }, base).material, false);
  assert.equal(diffIcRevisions({ ...base, poIds: ["new"] }, base).material, true);
  assert.equal(workingIcRevision({ ...emptyFinance(), revisions: [base] }, [{ id: "q", state: "SUBMITTED" }])?.id, "r");
  assert.throws(() => workingIcRevision({ ...emptyFinance(), revisions: [base, { ...base, id: "r2", requestId: "q2" }] }, [{ id: "q", state: "RETURNED" }, { id: "q2", state: "DRAFT" }]));
});

test("Incomplete IC retains unknown VAT versus explicit zero and rejects malformed filled values", () => {
  const line = { id: "line", description: "Print", unit: "set", quantity: "1", days: "1", unitPrice: "", basis: "NET" as const, vatPercent: "", cost: null };
  assert.deepEqual(draftLineIssues(line), ["missing-price", "missing-VAT"]);
  assert.throws(() => completeIcLines([line]));
  assert.throws(() => draftLineIssues({ ...line, unitPrice: "NaN" }));
  assert.throws(() => draftLineIssues({ ...line, unitPrice: "-1" }));
  assert.equal(completeIcLines([{ ...line, unitPrice: "100.4", vatPercent: "0" }])[0].cost.net, "100");
  assert.equal(totals(Array.from({ length: 3 }, () => calculateCost({ ...line, unitPrice: "100.4", vatPercent: "0" }))).net, "301");
  assert.equal(round(decimal("100.5")), "101");
  assert.equal(round(decimal("-100.5")), "-101");
});

test("PO versions and explicit replacements count once while legacy sources remain readable", () => {
  const pos: PurchaseOrder[] = [{ id: "a", number: "A", net: "100", sourceId: "original" }, { id: "b", number: "A", net: "120", sourceId: "revised", parentPoId: "a", poKey: "a", version: 2 }];
  const data = { ...emptyFinance(), pos };
  assert.equal(margin(data).revenue, "120");
  pos.push({ id: "c", number: "C", net: "150", sourceId: "replacement", replacesPoId: "b" });
  assert.deepEqual(currentPurchaseOrders(pos).map(po => po.id), ["c"]);
  assert.equal(margin(data).revenue, "150");
  assert.deepEqual(resolvePurchaseOrderHistory(pos, "c").map(po => po.id), ["a", "b", "c"]);
  pos.push({ id: "d", number: "D", net: "25", sourceId: "other" });
  assert.equal(margin(data).revenue, "175");
  assert.equal(pos[0].sourceId, "original");
});
