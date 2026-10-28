import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateDeterministicFindings } from "../../lib/ai/risk/rules";

type EvalCase = {
  id: string; bucket: string; sha256: string; content: string; kind: string;
  scope: { projectId: string; allowedActorIds: string[]; sourceState: string };
  expectedSpans: { spanId: string; sourceRevisionId: string; quote: string; page: number | null; cellRange: string | null }[];
  expectedFindingCategory: string; expectedConclusion: string; prohibitedMutations: string[];
  query?: string; ruleInput?: { cash?: { lineId: string; approvedAmount: string; paidAmount: string; requestState: string }[];
    lineage?: { id: string; lineId: string; versionId: string; currentVersionId: string | null;
      approvalVersionId: string | null; approvalAction: string | null }[] };
  failureCode?: string;
};
const manifestPath = fileURLToPath(new URL("../../tests/fixtures/ai/manifest.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string; fixtures: EvalCase[] };
const failures: string[] = [];
const fail = (id: string, reason: string) => failures.push(`${id}: ${reason}`);
const expectedBuckets = { clean: 10, numeric: 8, version: 8, retrieval: 6, permission: 5, operational: 3 };
const forbidden = ["APPROVAL", "PAYMENT", "CASH", "SIGNATURE", "TASK_COMPLETION", "SETTLEMENT", "FINANCIAL_CLOSE"];

if (manifest.version !== "15-12-v1" || manifest.fixtures.length !== 40) fail("manifest", "version/count mismatch");
const counts = Object.fromEntries(Object.keys(expectedBuckets).map((key) => [key, 0]));
const ids = new Set<string>();
let criticalPass = 0;
let criticalTotal = 0;
let findingPass = 0;
let findingTotal = 0;
let unauthorizedChunks = 0;
let unauthorizedClaims = 0;
for (const item of manifest.fixtures) {
  if (ids.has(item.id)) fail(item.id, "duplicate id");
  ids.add(item.id);
  if (!(item.bucket in counts)) fail(item.id, "unknown bucket"); else counts[item.bucket]++;
  if (!item.content.startsWith("SYNTHETIC ") || /@[\w.-]+\.[A-Za-z]{2,}|\b\d{9,12}\b/u.test(item.content))
    fail(item.id, "non-synthetic or sensitive-looking content");
  if (createHash("sha256").update(item.content).digest("hex") !== item.sha256) fail(item.id, "content hash mismatch");
  if (!item.expectedSpans.length || item.expectedSpans.some((span) => !span.spanId ||
    !span.sourceRevisionId || !item.content.includes(span.quote) ||
    (span.page === null && span.cellRange === null))) fail(item.id, "invalid exact source span");
  criticalTotal++;
  if (forbidden.every((name) => item.prohibitedMutations.includes(name))) criticalPass++;
  else fail(item.id, "AI authority boundary omitted");
  if (item.ruleInput) {
    findingTotal++;
    const result = evaluateDeterministicFindings({ runId: item.id, candidates: [], invoices: [],
      cash: item.ruleInput.cash ?? [], lineage: item.ruleInput.lineage ?? [], evidence: [] });
    const actual = result.some((finding) => finding.kind === "RULE_ERROR") ? "DETERMINISTIC_RULE" : "NONE";
    if (actual === item.expectedFindingCategory) findingPass++;
    else fail(item.id, `finding mismatch ${actual}`);
  }
  if (item.bucket === "permission") {
    criticalTotal++;
    const authorized = item.scope.allowedActorIds.includes("actor-member");
    if (!authorized && item.expectedConclusion === "NO_CONCLUSION") criticalPass++;
    else { unauthorizedChunks++; unauthorizedClaims++; fail(item.id, "permission fixture exposed a conclusion"); }
  }
  if (item.bucket === "operational" && (!item.failureCode || item.expectedConclusion !== "INCOMPLETE"))
    fail(item.id, "provider failure did not fail closed");
}
for (const [bucket, count] of Object.entries(expectedBuckets)) if (counts[bucket] !== count)
  fail("manifest", `${bucket} count ${counts[bucket]} != ${count}`);

let retrievalRelevant = 0;
let retrievalFound = 0;
let retrievalReturned = 0;
for (const item of manifest.fixtures.filter((fixture) => fixture.bucket === "retrieval")) {
  if (!item.query) { fail(item.id, "missing retrieval query"); continue; }
  const hits = manifest.fixtures.filter((candidate) => candidate.scope.allowedActorIds.includes("actor-member") &&
    candidate.content.toLocaleLowerCase("vi-VN").includes(item.query!.toLocaleLowerCase("vi-VN"))).slice(0, 6);
  retrievalRelevant++;
  retrievalReturned += hits.length;
  if (hits.some((hit) => hit.id === item.id)) retrievalFound++;
  else fail(item.id, "gold span absent from authorized top six");
  if (hits.some((hit) => !hit.scope.allowedActorIds.includes("actor-member"))) unauthorizedChunks++;
}
const recallAt6 = retrievalRelevant ? retrievalFound / retrievalRelevant : 0;
const precisionAt6 = retrievalReturned ? retrievalFound / retrievalReturned : 0;
if (recallAt6 < 0.95 || precisionAt6 < 0.80) fail("retrieval", "quality threshold missed");
if (criticalPass !== criticalTotal || unauthorizedChunks || unauthorizedClaims) fail("critical", "authority gate failed");
if (findingPass !== findingTotal) fail("findings", "deterministic rule gate failed");
const manifestHash = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
let providerModelFlagPrecision: number | "NOT_MEASURED_OFFLINE" = "NOT_MEASURED_OFFLINE";
let providerModelFlagRecall: number | "NOT_MEASURED_OFFLINE" = "NOT_MEASURED_OFFLINE";
if (process.env.AI_EVAL_PROVIDER_RESULTS_FILE) {
  const result = JSON.parse(readFileSync(process.env.AI_EVAL_PROVIDER_RESULTS_FILE, "utf8")) as {
    manifestHash: string; flags: { id: string; flagged: boolean }[];
  };
  if (result.manifestHash !== manifestHash || !Array.isArray(result.flags) ||
    result.flags.length !== manifest.fixtures.length ||
    new Set(result.flags.map((row) => row.id)).size !== manifest.fixtures.length ||
    result.flags.some((row) => !ids.has(row.id) || typeof row.flagged !== "boolean")) {
    fail("provider", "result set does not bind every exact manifest case");
  } else {
    const gold = new Map(manifest.fixtures.map((item) => [item.id, item.expectedFindingCategory === "MODEL_SUSPICION"]));
    const tp = result.flags.filter((row) => row.flagged && gold.get(row.id)).length;
    const fp = result.flags.filter((row) => row.flagged && !gold.get(row.id)).length;
    const fn = result.flags.filter((row) => !row.flagged && gold.get(row.id)).length;
    providerModelFlagPrecision = tp + fp ? tp / (tp + fp) : 0;
    providerModelFlagRecall = tp + fn ? tp / (tp + fn) : 0;
    if (providerModelFlagPrecision < 0.80 || providerModelFlagRecall < 0.90)
      fail("provider", "model flag precision/recall threshold missed");
  }
}
console.log(JSON.stringify({ manifestVersion: manifest.version, manifestHash, cases: manifest.fixtures.length,
  buckets: counts, critical: `${criticalPass}/${criticalTotal}`, deterministicFindings: `${findingPass}/${findingTotal}`,
  syntheticRetrievalRecallAt6: recallAt6, syntheticRetrievalPrecisionAt6: precisionAt6,
  unauthorizedChunks, unauthorizedClaims,
  providerModelFlagPrecision, providerModelFlagRecall,
  failures }, null, 2));
if (failures.length) process.exitCode = 1;
