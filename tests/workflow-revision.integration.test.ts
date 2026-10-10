import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { calculateSelectedAdvanceSettlement } from "../lib/costflow/paymentSettlement";

test("revision is an allowlisted clean draft with one active child and signed reason", async () => {
  const service = await readFile(new URL("../lib/workflow/service.ts", import.meta.url), "utf8");
  const revision = service.match(/case "REVISE_DOCUMENT":[\s\S]*?case "SUBMIT_DOCUMENT":/)?.[0] ?? "";
  assert.match(revision, /request\.state !== "APPROVED"/);
  assert.match(revision, /postSigningReason/);
  assert.match(revision, /content: body\.content/);
  assert.match(revision, /supportingFiles: \{\}/);
  for (const forbidden of ["templateSnapshot", "submittedFiles", "signature:", "execution:", "cancellation:", "currentAttemptId"]) assert.doesNotMatch(revision, new RegExp(forbidden));
  assert.match(service, /state: "REPLACED"/);
  assert.match(service, /replacedBySnapshotId/);
});

test("database enforces one active replacement per source", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20261010_phase9_revision_guard/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE UNIQUE INDEX "WorkflowRequest_one_active_replacement_per_source_key"/);
  assert.match(migration, /"state" IN \('DRAFT', 'SUBMITTED', 'RETURNED'\)/);
});

test("reference uploads are role-safe and do not mutate approval or signing", async () => {
  const service = await readFile(new URL("../lib/workflow/service.ts", import.meta.url), "utf8");
  const reference = service.match(/case "ADD_REFERENCE":[\s\S]*?case "UPLOAD_SIGNED":/)?.[0] ?? "";
  assert.match(reference, /responsibleManagerId/);
  assert.match(reference, /accountantId/);
  assert.match(reference, /file\(\{ requestId: request\.id \}, "REFERENCE"\)/);
  assert.doesNotMatch(reference, /state:\s*"DRAFT"|evidenceState|snapshot/);
});

test("cash remains explicit after confirmed signing and is exposed in both surfaces", async () => {
  const cash = await readFile(new URL("../lib/costflow/paymentCash.ts", import.meta.url), "utf8");
  const modal = await readFile(new URL("../components/ApprovalRequestsPanel.tsx", import.meta.url), "utf8");
  const settlement = await readFile(new URL("../components/SettlementPanel.tsx", import.meta.url), "utf8");
  assert.match(cash, /PHYSICAL_CONFIRMED|DIGITAL_CONFIRMED/);
  assert.match(modal, /CashConfirmationEditor/);
  assert.match(settlement, /CashConfirmationEditor/);
  assert.doesNotMatch(cash, /finalizeDigitalApprovedSnapshot/);
});

test("multi-advance settlement calculates exact refund and supplemental payout", () => {
  const actual = (approvedAmount: string) => ({ projectId: "p", versionId: "v", approvalEventId: "e", approvalAttemptId: "a", approvalState: "APPROVED" as const, stableLineId: "actual", recipientKey: "USER:u", fundingSource: "EMPLOYEE_ADVANCE" as const, approvedAmount });
  const advance = (advanceLineId: string) => ({ projectId: "p", recipientKey: "USER:u", advanceRequestId: `request-${advanceLineId}`, advanceLineId, grossOutAmount: "5000000", alreadyAppliedAmount: "0", selectedAmount: "5000000" });
  const base = { projectId: "p", recipientKey: "USER:u", approvedActualLines: [actual("8000000")], selectedAdvances: [advance("x"), advance("y")] };
  assert.deepEqual(calculateSelectedAdvanceSettlement(base), { selectedAdvanceLineIds: ["x", "y"], actualUsed: "8000000", advanceApplied: "10000000", unusedOrRefundDue: "2000000", overspendOrAdditionalDue: "0" });
  assert.deepEqual(calculateSelectedAdvanceSettlement({ ...base, approvedActualLines: [actual("12000000")] }), { selectedAdvanceLineIds: ["x", "y"], actualUsed: "12000000", advanceApplied: "10000000", unusedOrRefundDue: "0", overspendOrAdditionalDue: "2000000" });
});

test("overdue advance and execution-tracking contracts remain visible without auto cash", async () => {
  const editor = await readFile(new URL("../components/costflow/payments/PaymentRequestEditor.tsx", import.meta.url), "utf8");
  const approvals = await readFile(new URL("../components/ApprovalRequestsPanel.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../components/WorkflowPanel.tsx", import.meta.url), "utf8");
  assert.match(editor, /expectedSettlementDate/);
  assert.match(approvals, /Quá hạn hoàn ứng/);
  assert.match(panel, /requiresExecutionTracking/);
  assert.match(panel, /START_EXECUTION/);
});
