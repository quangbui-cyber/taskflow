import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(file) {
  return readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
}

test("Actual Cost sheet keeps every grouped row searchable in desktop and mobile flows", () => {
  const table = source("components/costflow/actual-cost/ActualCostSheetView.tsx");
  assert.match(table, /lines\.filter\(/);
  assert.match(table, /group\.lines\.map\(/);
  assert.match(table, /type="search"/);
  assert.match(table, /<table/);
  assert.match(table, /md:hidden/);
  assert.match(table, /hidden md:block/);
  assert.match(table, /aria-label="Các khoản thực chi"/);
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
