import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sources = Object.fromEntries(await Promise.all([
  ["schema", "prisma/schema.prisma"],
  ["cash", "lib/costflow/paymentCash.ts"],
  ["approvedAc", "lib/costflow/approvedActualCost.ts"],
  ["approvedSnapshot", "lib/workflow/approvedSnapshot.ts"],
  ["publicVerification", "lib/workflow/publicVerification.ts"],
].map(async ([key, relativePath]) => [key, await readFile(path.join(root, relativePath), "utf8")])));

const contracts = [
  {
    name: "Phase 8 exact DD-approved AC tuple",
    checks: [
      ["schema", /model ActualCostApproval\s*\{[\s\S]*?attemptId\s+String[\s\S]*?action\s+String[\s\S]*?@@unique\(\[versionId\]\)/],
      ["schema", /model ActualCostApplication\s*\{[\s\S]*?versionId\s+String[\s\S]*?approvalId\s+String[\s\S]*?state\s+String\s+@default\("ACTIVE"\)/],
      ["approvedAc", /resolveProductionApprovedActualCost/],
      ["approvedAc", /line\.projectId !== query\.projectId[\s\S]*?line\.versionId !== ref\.versionId[\s\S]*?line\.approvalEventId !== ref\.approvalEventId[\s\S]*?line\.approvalAttemptId !== ref\.approvalAttemptId/],
      ["approvedAc", /line\.approvalState !== "APPROVED"/],
    ],
  },
  {
    name: "Phase 7 disbursed advance and normalized cash allocation",
    checks: [
      ["schema", /model CostFlowCashAllocation\s*\{[\s\S]*?cashId\s+String[\s\S]*?requestLineId\s+String[\s\S]*?recipientKey\s+String[\s\S]*?direction\s+String[\s\S]*?@@unique\(\[cashId, requestLineId\]\)/],
      ["schema", /model AdvanceApplication\s*\{[\s\S]*?advanceRequestId\s+String[\s\S]*?advanceLineId\s+String[\s\S]*?recipientKey\s+String[\s\S]*?amount\s+String/],
      ["cash", /normalizedAllocations:\s*\{\s*create:/],
      ["cash", /requestId,\s*requestLineId:\s*item\.requestLineId,\s*recipientKey,\s*direction,\s*amount:\s*item\.amount/],
      ["cash", /request\.state !== "APPROVED"/],
    ],
  },
  {
    name: "Phase 9 immutable approved snapshot and confirmed signing evidence",
    checks: [
      ["schema", /model WorkflowApprovedSnapshot\s*\{[\s\S]*?projectionSha256\s+String[\s\S]*?attestation\s+String[\s\S]*?@@unique\(\[requestId, version\]\)/],
      ["schema", /model WorkflowSigningEvent\s*\{[\s\S]*?snapshotId\s+String\?[\s\S]*?eventHash\s+String[\s\S]*?signedAt\s+DateTime/],
      ["approvedSnapshot", /computeApprovedProjectionSha256/],
      ["approvedSnapshot", /signatures:[\s\S]*?eventHash/],
      ["publicVerification", /evidenceState !== "DIGITAL_CONFIRMED"/],
      ["publicVerification", /evidenceState !== "PHYSICAL_CONFIRMED"/],
    ],
  },
  {
    name: "Phase 9 opaque public-verification capability",
    checks: [
      ["schema", /model WorkflowPublicVerificationCapability\s*\{[\s\S]*?publicNonce\s+String\s+@unique[\s\S]*?tokenDigest\s+String\s+@unique[\s\S]*?revokedAt\s+DateTime\?[\s\S]*?replacedAt\s+DateTime\?/],
      ["publicVerification", /derivePublicVerificationToken/],
      ["publicVerification", /digestPublicVerificationToken/],
      ["publicVerification", /randomBytes\(32\)\.toString\("base64url"\)/],
      ["publicVerification", /\/workflow\/verify\/\$\{encodeURIComponent\(token\)\}/],
      ["publicVerification", /findUnique\(\{\s*where:\s*\{ tokenDigest \}/],
    ],
  },
];

const missing = [];
for (const contract of contracts) {
  const failures = contract.checks.filter(([source, pattern]) => !pattern.test(sources[source]));
  if (failures.length) {
    missing.push(`${contract.name}: ${failures.length} structural check(s) missing`);
  }
}

if (missing.length) {
  console.error("PHASE 10 BLOCKED: required producer contracts are incomplete.");
  for (const item of missing) console.error(`- ${item}`);
  console.error("Restore/finish the Phase 7-9 producer contracts before any Phase 10 DDL. This preflight does not mark an upstream phase complete.");
  process.exit(1);
}

assert.equal(contracts.length, 4);
console.log(JSON.stringify({
  ok: true,
  contracts: contracts.map(({ name }) => name),
  note: "Structural producer contracts are present; no upstream phase-completion claim was made.",
}, null, 2));
