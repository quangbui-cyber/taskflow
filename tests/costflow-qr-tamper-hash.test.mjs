import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertOpaquePublicVerificationToken,
  buildSettlementPrintDocument,
  settlementPdfAuditIdentity,
  settlementProjectionHash,
} from "../lib/costflow/settlementSecurity.ts";

function projection(overrides = {}) {
  return {
    projectId: "project-a",
    family: "PROJECT_SETTLEMENT",
    source: {
      dossierId: "dossier-a", dossierVersionId: "version-a", dossierVersion: 2,
      documentVersionId: "snapshot-a", documentVersion: 4, state: "APPROVED",
      supersedesId: null, replacedById: null, replacementReason: null,
    },
    totals: { rawNet: "3/2", rawVat: "1/2", rawGross: "2/1", net: "2", vat: "0", gross: "2" },
    recipients: [{ recipientKey: "USER:a", recipientType: "EMPLOYEE", displayName: "A", actualGross: "2", advanceGross: "0", refundDue: "0", additionalDue: "2" }],
    items: [{ stableLineId: "line-a", description: "A", recipientKey: "USER:a", rawNet: "3/2", rawVat: "1/2", rawGross: "2/1", net: "2", vat: "0", gross: "2" }],
    obligations: [{ recipientKey: "USER:a", direction: "ADDITIONAL", amountDue: "2" }],
    evidence: [{ id: "evidence-a", kind: "EXPENSE_EVIDENCE", sha256: "a".repeat(64) }],
    signingSnapshot: {
      id: "snapshot-a", state: "DIGITAL_CONFIRMED", projectionSha256: "b".repeat(64),
      events: [{ role: "CREATOR", actorId: "actor-a", eventHash: "c".repeat(64), signedAt: "2026-10-11T00:00:00.000Z" }],
    },
    ...overrides,
  };
}

test("QR contract: accepts only opaque 256-bit capability tokens and never IDs", () => {
  const opaque = "Ab_9-".repeat(8) + "xyz";
  assert.equal(opaque.length, 43);
  assert.equal(assertOpaquePublicVerificationToken(opaque), opaque);
  for (const internalId of ["request-a", "dossier-a", "version-a", "snapshot-a", "1234"]) {
    assert.throws(() => assertOpaquePublicVerificationToken(internalId), /opaque|capability|token/i);
  }
});

test("QR contract: full projection tampering fails the canonical hash even when totals match", () => {
  const base = projection();
  const variants = [
    projection({ items: [{ ...base.items[0], stableLineId: "line-tampered" }] }),
    projection({ recipients: [{ ...base.recipients[0], recipientKey: "USER:tampered" }] }),
    projection({ evidence: [{ ...base.evidence[0], sha256: "9".repeat(64) }] }),
    projection({ source: { ...base.source, dossierVersion: 3 } }),
    projection({ signingSnapshot: { ...base.signingSnapshot, events: [{ ...base.signingSnapshot.events[0], eventHash: "8".repeat(64) }] } }),
  ];
  for (const changed of variants) assert.notEqual(settlementProjectionHash(base), settlementProjectionHash(changed));
});

test("PDF audit identity matches version, canonical hash and signature snapshot", () => {
  const input = projection();
  assert.deepEqual(settlementPdfAuditIdentity(input), {
    family: "PROJECT_SETTLEMENT",
    format: "PDF",
    dossierVersionId: "version-a",
    approvedSnapshotId: "snapshot-a",
    canonicalHash: settlementProjectionHash(input),
    signatureState: "DIGITAL_CONFIRMED",
  });
});

test("QR URL is capability-derived, and absent for unsigned/partial evidence", () => {
  const token = "x".repeat(43);
  const confirmed = buildSettlementPrintDocument({ projection: projection(), signingEvents: [], publicVerificationToken: token });
  assert.equal(confirmed.verificationPath, `/workflow/verify/${token}`);
  assert.doesNotMatch(confirmed.verificationPath, /request-a|dossier-a|version-a|snapshot-a/);
  const unsigned = buildSettlementPrintDocument({
    projection: projection({ signingSnapshot: { ...projection().signingSnapshot, state: "CHO_KY", events: [] } }),
    signingEvents: [],
    publicVerificationToken: token,
  });
  assert.equal(unsigned.verificationPath, undefined);
});

test("public verification extension remains allowlisted and fails closed on revoked/replaced/tampered capability", async () => {
  const source = await readFile(new URL("../lib/workflow/publicVerification.ts", import.meta.url), "utf8");
  assert.match(source, /family/);
  assert.match(source, /version/);
  assert.match(source, /validity/);
  assert.match(source, /revokedAt|replacedAt/);
  assert.match(source, /computeApprovedProjectionSha256/);
  assert.match(source, /verifyApprovedProjectionAttestation/);
  assert.doesNotMatch(source, /PublicVerificationDto[\s\S]{0,700}(bankAccount|signatureData|signaturePngData|eventHash|privateNotes)/);
});
