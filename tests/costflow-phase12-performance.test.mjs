import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import { performance } from "node:perf_hooks";

import { buildSettlementExportWorkbook } from "../lib/costflow/export.ts";
import { renderCostFlowPdf } from "../lib/costflow/pdfExport.ts";
import { buildProjectSettlementDraft } from "../lib/costflow/projectSettlement.ts";
import { PHASE12_TEST_DATABASE_URL, assertPhase12TestDatabaseUrl } from "./phase12/pilotFixture.ts";

const projectId = "phase12-performance-project";
const lineCount = 180;
const recipientCount = 18;
const evidenceCount = 40;
const sampleCount = 7;

function percentile(samples, ratio) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

function statistics(samples) {
  const ordered = [...samples].sort((left, right) => left - right);
  return {
    samples: ordered.map(value => Number(value.toFixed(3))),
    min: Number(ordered[0].toFixed(3)),
    median: Number(percentile(ordered, 0.5).toFixed(3)),
    p95: Number(percentile(ordered, 0.95).toFixed(3)),
    max: Number(ordered.at(-1).toFixed(3)),
  };
}

async function measure(operation) {
  await operation();
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  return statistics(samples);
}

function representativeInput() {
  const evidence = Array.from({ length: evidenceCount }, (_, index) => ({
    id: `evidence-${index}`,
    sha256: createHash("sha256").update(`phase12-evidence-${index}`).digest("hex"),
    origin: "INHERITED",
    satisfies: ["EXPENSE_EVIDENCE"],
  }));
  const actualCostLines = Array.from({ length: lineCount }, (_, index) => {
    const recipientIndex = index % recipientCount;
    const versionId = `actual-version-${index}`;
    const approvalEventId = `actual-approval-${index}`;
    const approvalAttemptId = `actual-attempt-${index}`;
    return {
      projectId,
      recipientKey: `USER:recipient-${recipientIndex}`,
      recipientType: "EMPLOYEE",
      recipientName: `Recipient ${recipientIndex + 1}`,
      stableLineId: `actual-line-${String(index).padStart(3, "0")}`,
      versionId,
      approvalEventId,
      approvalAttemptId,
      approvalState: "APPROVED",
      currentApprovalTuple: { versionId, approvalEventId, approvalAttemptId },
      rawNet: "100000",
      rawVat: "8000",
      rawGross: "108000",
      relatedIcAcReferences: [{ id: `ic-line-${index}`, kind: "IC_LINE" }],
      evidence: [evidence[index % evidence.length]],
    };
  });
  return { projectId, actualCostLines, advanceAllocations: [], evidence };
}

function exportProjection(input, draft) {
  const signingHash = "a".repeat(64);
  return {
    projectId,
    projectName: "Phase 12 representative performance",
    family: "PROJECT_SETTLEMENT",
    title: "Phase 12 performance settlement",
    approvedAt: "2026-10-13T00:00:00.000Z",
    source: {
      dossierId: "dossier-performance",
      dossierVersionId: "dossier-version-performance",
      dossierVersion: 1,
      documentVersionId: "document-version-performance",
      documentVersion: 1,
      state: "APPROVED",
      supersedesId: null,
      replacedById: null,
      replacementReason: null,
    },
    totals: {
      rawNet: `${lineCount * 100000}/1`,
      rawVat: `${lineCount * 8000}/1`,
      rawGross: `${lineCount * 108000}/1`,
      net: String(lineCount * 100000),
      vat: String(lineCount * 8000),
      gross: String(lineCount * 108000),
    },
    recipients: draft.recipients.map(row => ({
      recipientKey: row.recipientKey,
      recipientType: row.recipientType,
      displayName: row.recipientName,
      actualGross: row.actualGross,
      advanceGross: row.advanceGross,
      refundDue: row.refundDue,
      additionalDue: row.additionalDue,
    })),
    items: input.actualCostLines.map(row => ({
      stableLineId: row.stableLineId,
      description: `Representative AC ${row.stableLineId}`,
      recipientKey: row.recipientKey,
      rawNet: row.rawNet,
      rawVat: row.rawVat,
      rawGross: row.rawGross,
      net: row.rawNet,
      vat: row.rawVat,
      gross: row.rawGross,
    })),
    obligations: draft.recipients.map(row => ({ recipientKey: row.recipientKey, direction: row.refundDue !== "0" ? "REFUND" : "ADDITIONAL", amountDue: row.refundDue !== "0" ? row.refundDue : row.additionalDue })),
    evidence: input.evidence.map(row => ({ id: row.id, kind: "EXPENSE_EVIDENCE", sha256: row.sha256 })),
    signingSnapshot: { id: "snapshot-performance", state: "DIGITAL_CONFIRMED", projectionSha256: signingHash, events: [] },
  };
}

test("Phase 12 representative workload reports transparent percentiles within local targets", async () => {
  assertPhase12TestDatabaseUrl(process.env.DATABASE_URL ?? PHASE12_TEST_DATABASE_URL);
  const input = representativeInput();
  assert.equal(input.actualCostLines.length, 180);
  assert.equal(new Set(input.actualCostLines.map(row => row.recipientKey)).size, 18);
  assert.equal(input.evidence.length, 40);

  let draft = buildProjectSettlementDraft(input);
  assert.equal(draft.recipients.length, recipientCount);
  assert.equal(draft.canSubmit, true);
  const projection = exportProjection(input, draft);
  const sourceProjection = {
    family: "PROJECT_SETTLEMENT",
    sourceKind: "PROJECT_SETTLEMENT",
    sourceId: projection.source.dossierVersionId,
    sourceVersion: 1,
    approvalAttemptId: "attempt-performance",
    approvedSnapshotId: projection.signingSnapshot.id,
    signingState: projection.signingSnapshot.state,
    projectionHash: createHash("sha256").update(JSON.stringify(projection)).digest("hex"),
  };

  const reconciliation = await measure(() => { draft = buildProjectSettlementDraft(input); });
  const xlsx = await measure(async () => { const artifact = await buildSettlementExportWorkbook(projection); assert.ok(artifact.bytes.length > 0); });
  const pdf = await measure(() => { const bytes = renderCostFlowPdf({ projection, sourceProjection }); assert.ok(bytes.length > 0); });
  const report = {
    provenance: "automated_local",
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
      logicalCpus: os.cpus().length,
      totalMemoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    },
    cardinality: { lineCount, recipientCount, evidenceCount },
    sampleCount,
    milliseconds: { reconciliation, xlsx, pdf },
    targets: { reconciliationP95: 1000, xlsxP95: 3000, pdfP95: 5000 },
  };
  console.log(`PHASE12_PERFORMANCE ${JSON.stringify(report)}`);
  assert.ok(reconciliation.p95 < report.targets.reconciliationP95, JSON.stringify(report));
  assert.ok(xlsx.p95 < report.targets.xlsxP95, JSON.stringify(report));
  assert.ok(pdf.p95 < report.targets.pdfP95, JSON.stringify(report));
});
