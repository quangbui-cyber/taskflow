import test from "node:test";
import assert from "node:assert/strict";

const families = [
  "QUOTATION",
  "CUSTOMER_ACCEPTANCE",
  "DNTU",
  "DNTT",
  "DNHTU",
  "PROJECT_SETTLEMENT",
];

test("six export families preserve exact source identity, privacy and aggregate-first rounding", async () => {
  const { buildExportSourceSeal } = await import("../lib/costflow/exportSourceProjection.ts");
  const seals = families.map((family, index) => buildExportSourceSeal({
    projectId: "project-a",
    family,
    sourceKind: family === "DNTU" ? "ADVANCE" : family === "DNTT" ? "VENDOR_PAYMENT" : family === "DNHTU" ? "REIMBURSEMENT" : family,
    sourceId: `source-${index}`,
    sourceVersion: index + 1,
    approvalAttemptId: `attempt-${index}`,
    approvedSnapshotId: family === "DNTU" || family === "DNTT" || family === "DNHTU" ? `snapshot-${index}` : null,
    signingState: family === "DNTU" || family === "DNTT" || family === "DNHTU" ? "DIGITAL_CONFIRMED" : "UNSIGNED",
    payload: family === "QUOTATION" || family === "CUSTOMER_ACCEPTANCE"
      ? { title: `${family}-${index}`, customer: "Customer", rows: [{ id: "line-a", description: "Public" }] }
      : { title: `${family}-${index}`, recipient: { bankAccount: "SECRET" }, evidence: [{ sha256: "a".repeat(64) }] },
    lines: [
      { id: "line-a", rawNet: "10049/10", rawVat: "401/10", rawGross: "1045/1", vatPercent: "4" },
      { id: "line-b", rawNet: "20049/10", rawVat: "801/10", rawGross: "2085/1", vatPercent: "4" },
    ],
  }));

  assert.equal(new Set(seals.map(seal => seal.projectionHash)).size, six());
  for (const seal of seals) {
    assert.deepEqual(seal.totals, { net: "3010", vat: "120", gross: "3130" });
    assert.equal(seal.roundingAdjustment, 0);
    assert.deepEqual(seal.vatLineAssignment, { lineId: "line-b", adjustment: 0 });
  }
  for (const seal of seals.slice(0, 2)) {
    assert.equal(JSON.stringify(seal.canonicalPayload).includes("SECRET"), false);
    assert.equal(JSON.stringify(seal.canonicalPayload).includes("bankAccount"), false);
    assert.equal(JSON.stringify(seal.canonicalPayload).includes("evidence"), false);
  }
});

test("rounding allows only -1, 0 or +1 before a seal exists", async () => {
  const { buildExportSourceSeal } = await import("../lib/costflow/exportSourceProjection.ts");
  const base = {
    projectId: "project-a",
    family: "QUOTATION",
    sourceKind: "QUOTATION",
    sourceId: "quote-a",
    sourceVersion: 1,
    approvalAttemptId: "finalize-a",
    approvedSnapshotId: null,
    signingState: "UNSIGNED",
    payload: { title: "Quote" },
    lines: [{ id: "line", rawNet: "100", rawVat: "8", rawGross: "108", vatPercent: "8" }],
  };
  assert.throws(() => buildExportSourceSeal({ ...base, authoritativeTotals: { net: "100", vat: "8", gross: "110" } }), /-1, 0 hoặc \+1/);
});

function six() {
  return 6;
}
