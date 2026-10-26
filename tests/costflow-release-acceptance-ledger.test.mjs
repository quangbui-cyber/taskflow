import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ledger = readFileSync(resolve(import.meta.dirname, "..", "docs", "costflow-manual", "RELEASE_ACCEPTANCE_LEDGER.md"), "utf8");

test("shared ledger keeps technical, production, native and company evidence separate", () => {
  for (const axis of ["Automated local", "Authenticated production", "Native / physical", "Company acceptance"]) {
    assert.match(ledger, new RegExp(axis.replace("/", "\\/")));
  }
  assert.match(ledger, /`RELEASE_VERDICT: NOT_READY`/);
  assert.doesNotMatch(ledger, /`RELEASE_VERDICT: READY`/);
});

test("Bảng AC and Phase 14 share one pending authenticated production batch", () => {
  assert.match(ledger, /One combined authenticated production confirmation batch/);
  assert.match(ledger, /Bảng AC/);
  assert.match(ledger, /Phase 14/);
  for (const id of ["PROD-AC14-01", "PROD-AC14-02", "PROD-AC14-03", "PROD-AC14-04", "PROD-AC14-05", "PROD-AC14-06"]) {
    const row = ledger.split("\n").find(line => line.includes(`\`${id}\``));
    assert.ok(row, `missing ${id}`);
    assert.match(row, /`PENDING`/);
  }
});

test("Phase 11 stays locked until actor and reminder calendar are confirmed", () => {
  assert.match(ledger, /`PHASE_11_STATUS: LOCKED_PENDING_DIRECT_CONFIRMATION`/);
  assert.match(ledger, /actor\(s\) allowed to mark/);
  assert.match(ledger, /company calendar and reminder schedule/);
  assert.match(ledger, /proposals, not accepted decisions/);
});
