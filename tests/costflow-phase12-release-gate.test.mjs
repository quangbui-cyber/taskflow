import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const docs = resolve(root, "docs", "costflow-manual");
const evidence = readFileSync(resolve(docs, "PHASE12_EVIDENCE_INDEX.md"), "utf8");
const signoff = readFileSync(resolve(docs, "RELEASE_SIGN_OFF.md"), "utf8");
const production = readFileSync(resolve(docs, "PRODUCTION_READINESS_RUNBOOK.md"), "utf8");
const namedSlots = ["EV-SIGN-HUY", "EV-SIGN-QUANG", "EV-SIGN-UYEN", "EV-SIGN-SON"];

function statusForSlot(markdown, slot) {
  const row = markdown.split("\n").find((line) => line.includes(`| \`${slot}\``));
  assert.ok(row, `missing ${slot}`);
  return row;
}

test("Phase 12 evidence index keeps all five provenance classes and exact requirement links", () => {
  for (const provenance of ["automated_local", "browser_local", "native_human", "company_pilot", "production"]) {
    assert.ok(evidence.includes(`\`${provenance}\``), `missing provenance ${provenance}`);
  }
  for (const requirement of ["CFP-01", "CFP-02", "CFP-03"]) assert.match(evidence, new RegExp(`\\\`${requirement}\\\`: \\\`PENDING\\\``));
  for (const criterion of ["GL-01", "GL-02", "GL-03", "GL-04", "GL-05"]) assert.ok(evidence.includes(`\`${criterion}\``));
  for (const id of ["EV-AUTO-01", "EV-AUTO-05", "EV-BROWSER-01", "EV-NATIVE-01", "EV-PILOT-01", "EV-PROD-01"]) assert.ok(evidence.includes(`\`${id}\``));
});

test("release charter fails closed while human, company or production evidence is pending", () => {
  assert.match(signoff, /`RELEASE_VERDICT: NOT_READY`/);
  assert.match(signoff, /`PHASE_STATUS: human_needed`/);
  for (const slot of namedSlots) {
    const row = statusForSlot(signoff, slot);
    assert.match(row, /`PENDING`/);
    assert.doesNotMatch(row, /APPROVED|SIGNED|READY|\d{4}-\d{2}-\d{2}T/);
  }
  assert.match(evidence, /Release: `NOT_READY`/);
  assert.match(evidence, /Phase status: `human_needed`/);
  assert.doesNotMatch(`${evidence}\n${signoff}`, /RELEASE_VERDICT:\s*(?:READY|APPROVED)/);
});

test("production runbook is an unchecked dry run and cannot self-certify deployment", () => {
  assert.match(production, /`STATUS: NOT_EXECUTED`/);
  assert.match(production, /- \[ \] `PROD-BACKUP-01`/);
  assert.match(production, /- \[ \] `PROD-MIGRATION-01`/);
  assert.match(production, /- \[ \] `PROD-SMOKE-01`/);
  assert.match(production, /- \[ \] `PROD-ROLLBACK-01`/);
  assert.doesNotMatch(production, /- \[x\]/i);
  assert.doesNotMatch(production, /(?:deployment|migration|backup)\s+(?:completed|passed|successful)/i);
  assert.match(production, /Không seed\/reset/);
  assert.match(production, /Không dùng destructive database rollback/);
});
