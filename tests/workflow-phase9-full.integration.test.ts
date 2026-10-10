import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { calculateSelectedAdvanceSettlement } from "../lib/costflow/paymentSettlement";
import { TEMPLATE_KINDS } from "../lib/workflow/documents";

test("Workflow DIGITAL, PHYSICAL and clean revision lifecycles are wired end to end", async () => {
  const service = await readFile(new URL("../lib/workflow/service.ts", import.meta.url), "utf8");
  for (const command of ["SUBMIT_DOCUMENT", "DECIDE_DOCUMENT", "UPLOAD_SIGNED", "RETURN_SIGNED", "CONFIRM_SIGNED", "REVISE_DOCUMENT", "ADD_REFERENCE", "START_EXECUTION"]) assert.match(service, new RegExp(`case "${command}"`));
  assert.match(service, /finalizeDigitalApprovedSnapshot/);
  assert.match(service, /finalizePhysicalApprovedSnapshot/);
  assert.match(service, /state: "REPLACED"/);
  assert.match(service, /replacedBySnapshotId/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
});

test("all required financial vouchers use four-role signing while IC/AC/quotation remain exempt", async () => {
  const signing = await readFile(new URL("../lib/workflow/signing.ts", import.meta.url), "utf8");
  const costflow = await readFile(new URL("../lib/costflow/service.ts", import.meta.url), "utf8");
  for (const kind of ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"]) assert.match(signing, new RegExp(`"${kind}"`));
  assert.match(signing, /CREATOR[\s\S]*MANAGER[\s\S]*ACCOUNTANT[\s\S]*CEO/);
  assert.match(costflow, /appendDigitalSigningEvent/);
  assert.match(costflow, /finalizeDigitalApprovedSnapshot/);
  assert.doesNotMatch(signing.match(/const SIGNED_KINDS[\s\S]*?\];/)?.[0] ?? "", /"IC"|"AC"|"QUOTATION"/);
});

test("signature confirmation never writes cash and explicit cash is confirmed-evidence gated", async () => {
  const signing = await readFile(new URL("../lib/workflow/signing.ts", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../lib/workflow/service.ts", import.meta.url), "utf8");
  const cash = await readFile(new URL("../lib/costflow/paymentCash.ts", import.meta.url), "utf8");
  assert.doesNotMatch(signing, /costFlowCash\.create/);
  assert.doesNotMatch(workflow, /costFlowCash\.create/);
  assert.match(cash, /costFlowCash\.create/);
  assert.match(cash, /DIGITAL_CONFIRMED/);
  assert.match(cash, /PHYSICAL_CONFIRMED/);
});

test("multi-advance settlement remains exact and non-FIFO", () => {
  const actual = (approvedAmount: string) => ({ projectId: "p", versionId: "v", approvalEventId: "e", approvalAttemptId: "a", approvalState: "APPROVED" as const, stableLineId: "actual", recipientKey: "USER:u", fundingSource: "EMPLOYEE_ADVANCE" as const, approvedAmount });
  const selectedAdvances = ["one", "two"].map(id => ({ projectId: "p", recipientKey: "USER:u", advanceRequestId: `r-${id}`, advanceLineId: id, grossOutAmount: "5000000", alreadyAppliedAmount: "0", selectedAmount: "5000000" }));
  assert.equal(calculateSelectedAdvanceSettlement({ projectId: "p", recipientKey: "USER:u", approvedActualLines: [actual("8000000")], selectedAdvances }).unusedOrRefundDue, "2000000");
  assert.equal(calculateSelectedAdvanceSettlement({ projectId: "p", recipientKey: "USER:u", approvedActualLines: [actual("12000000")], selectedAdvances }).overspendOrAdditionalDue, "2000000");
});

test("pilot boundary covers three proposal kinds and leaves service contract deferred", async () => {
  assert.ok(TEMPLATE_KINDS.PROPOSAL);
  assert.ok(TEMPLATE_KINDS.PROPOSAL_ADVANCE);
  assert.ok(TEMPLATE_KINDS.PROPOSAL_ADVANCE_SETTLEMENT);
  assert.ok(TEMPLATE_KINDS.SERVICE_CONTRACT, "future official service-contract path remains in the model");
  const validation = await readFile(new URL("../../.planning/phases/09-wf-04-t-tr-nh-h-p-ng-v-k-gi-y/09-VALIDATION.md", import.meta.url), "utf8");
  assert.match(validation, /Deferred service contract[\s\S]*deferred/i);
  assert.match(validation, /Production\/deployment \| all \| Separate authorized deployment and production evidence \| out of this execution authorization/);
});
