import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manualDir = resolve(root, "docs", "costflow-manual");
const files = [
  "01_ACCOUNT_GUIDE.md",
  "02_ACCOUNTANT_CASHIER_GUIDE.md",
  "03_MANAGER_CEO_GUIDE.md",
  "WORKFLOW_CHEAT_SHEET.md",
  "KNOWN_LIMITATIONS_MATRIX.md",
  "INCIDENT_RESPONSE_RUNBOOK.md",
];
const documents = new Map(files.map((name) => [name, readFileSync(resolve(manualDir, name), "utf8")]));
const corpus = [...documents.values()].join("\n");

test("Phase 12 manuals reference only current workflow and CostFlow route contracts", () => {
  const routeSource = readFileSync(resolve(root, "lib", "workflow", "routes.ts"), "utf8");
  for (const fragment of ["/workflow", "/projects/${routeSegment(projectId)}/costflow?tab=approvals", "#request-"]) {
    assert.match(routeSource, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const route of [
    "/projects/{projectId}/costflow",
    "/projects/{projectId}/costflow?tab=approvals",
    "/workflow",
    "/workflow/{requestId}",
    "/workflow/{requestId}/print",
    "/workflow/verify/{token}",
  ]) assert.ok(corpus.includes(route), `missing current route ${route}`);
  assert.doesNotMatch(corpus, /\/costflow\/requests\/all|\/workflow\/public\/|\/admin\/cash-bypass/);
});

test("manuals preserve approval, budget, cash, signing, task and close boundaries", () => {
  for (const phrase of [
    "Task `DONE`",
    "approval",
    "cash",
    "signing",
    "financial close",
    "Phase 11",
    "không chỉnh raw SQL",
  ]) assert.ok(corpus.toLowerCase().includes(phrase.toLowerCase()), `missing safety phrase: ${phrase}`);
  assert.match(corpus, /CEO `RETURN` hoặc `REJECT`[\s\S]*không tự/);
  assert.match(corpus, /REOPEN[\s\S]*B02\/correction/);
});

test("governance docs use PowerShell-safe commands and retain unverified release gates", () => {
  const incident = documents.get("INCIDENT_RESPONSE_RUNBOOK.md");
  const limitations = documents.get("KNOWN_LIMITATIONS_MATRIX.md");
  assert.match(incident, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File \.\\\.codex-tmp\\run-local-test\.ps1/);
  assert.match(incident, /npm\.cmd run test:costflow/);
  assert.match(incident, /npx\.cmd tsc --noEmit/);
  assert.match(incident, /npx\.cmd next build --webpack/);
  assert.match(limitations, /`PENDING`/);
  assert.match(limitations, /`human_needed`/);
  assert.match(limitations, /`OUT_OF_SCOPE`/);
  assert.doesNotMatch(corpus, /(?:company sign-off|production acceptance|production passed|go-live approved)\s*[:=]?\s*(?:confirmed|passed|complete|done)/i);
  assert.doesNotMatch(corpus, /\b(?:84|153|181)\s*\/\s*(?:84|153|181)\b/);
  assert.doesNotMatch(corpus, /(?:UPDATE|DELETE|INSERT)\s+(?:costflow|workflow|cash|settlement)/i);
});
