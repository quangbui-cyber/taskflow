import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(file) {
  return readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
}

test("Actual Cost keeps every filtered row rendered, searchable and semantically labeled", () => {
  const table = source("components/costflow/actual-cost/ActualCostTable.tsx");
  assert.match(table, /actualCosts\.lines\.filter/);
  assert.match(table, /lines\.map\(/);
  assert.match(table, /type="search"/);
  assert.match(table, /<Table caption=/);
  assert.match(table, /scope="col"/);
  assert.match(table, /scope="row"/);
  assert.match(table, /tf-ac-desktop/);
  assert.match(table, /tf-ac-mobile/);
  assert.match(table, /min-h-11/);
  assert.doesNotMatch(table, /(?:pageSize|pageIndex|currentPage|virtuali[sz]|\.slice\s*\()/i);
});

test("Project settlement keeps all obligations in continuous desktop and mobile flows", () => {
  const table = source("components/costflow/settlement/ProjectSettlementTable.tsx");
  assert.match(table, /version\.obligations\.map\(/);
  assert.match(table, /<Table caption=/);
  assert.match(table, /scope="col"/);
  assert.match(table, /scope="row"/);
  assert.match(table, /tf-payment-ledger-table/);
  assert.match(table, /tf-payment-ledger-cards/);
  assert.match(table, /aria-label=/);
  assert.match(table, /min-h-11/);
  assert.doesNotMatch(table, /(?:pageSize|pageIndex|currentPage|virtuali[sz]|\.slice\s*\()/i);
});
