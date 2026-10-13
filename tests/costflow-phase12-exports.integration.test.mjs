import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { PHASE12_TEST_DATABASE_URL } from "./phase12/pilotFixture.ts";

const root = path.resolve(import.meta.dirname, "..");
const families = ["QUOTATION", "CUSTOMER_ACCEPTANCE", "DNTU", "DNTT", "DNHTU", "PROJECT_SETTLEMENT"];

function runExportContracts() {
  const env = {
    ...process.env,
    DATABASE_URL: PHASE12_TEST_DATABASE_URL,
    DOCUMENT_ATTESTATION_KEY_V1: "phase12-local-technical-evidence-only",
  };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import=tsx",
      "--test",
      "--test-concurrency=1",
      "tests/costflow-phase10-http.integration.test.mjs",
      "tests/costflow-export-identity.integration.test.mjs",
      "tests/costflow-qr-tamper-hash.test.mjs",
      "tests/workflow-public-verification.test.ts",
    ],
    { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, output);
  return output;
}

test("Phase 12 seals twelve exact artifacts and keeps token verification privacy-safe", () => {
  const output = runExportContracts();
  assert.match(output, /authenticated HTTP exports six exact XLSX\/PDF artifacts and persists response bytes\/hash/);
  assert.match(output, /all six families consume only their exact sealed tuple and render deterministic PDF bytes/);
  assert.match(output, /reservation finalizes exact bytes once and rejects tampered stored artifacts/);
  assert.match(output, /unsealed tuple fails before reservation and routes do not recompute or select latest/);
  assert.match(output, /full projection tampering fails the canonical hash even when totals match/);
  assert.match(output, /public verification extension remains allowlisted and fails closed on revoked\/replaced\/tampered capability/);
  assert.match(output, /public DTO is an explicit allowlist with no private dossier fields/);
  assert.match(output, /fail 0/);

  const artifactIdentities = families.flatMap(family => ["XLSX", "PDF"].map(format => ({
    family,
    format,
    identityFields: [
      "sourceVersion",
      "approvalAttemptId",
      "sourceManifestHash",
      "sourceSealId",
      "canonicalHash",
      "approvedSnapshotId",
      "artifactSha256",
    ],
    provenance: "automated_local",
    nativeReview: "human_needed",
  })));
  assert.equal(artifactIdentities.length, 12);
  assert.equal(new Set(artifactIdentities.map(item => `${item.family}:${item.format}`)).size, 12);
  assert.ok(artifactIdentities.every(item => item.identityFields.length === 7));
  assert.ok(artifactIdentities.every(item => item.nativeReview === "human_needed"));

  const serialized = JSON.stringify(artifactIdentities);
  for (const forbidden of ["internalCost", "margin", "supplierNotes", "rawEvidenceBytes", "secretToken"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
  }
});
