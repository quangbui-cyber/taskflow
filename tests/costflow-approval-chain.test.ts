import assert from "node:assert/strict";
import test from "node:test";
import { ordinaryApprovalSteps } from "../lib/costflow/approvalChain";

test("ordinary approval projection uses the creator's direct manager", () => {
  assert.deepEqual(ordinaryApprovalSteps({
    directManagerId: "manager-direct",
    accountantId: "accountant",
    ceoId: "ceo",
  }), [
    { role: "MANAGER", assigneeId: "manager-direct" },
    { role: "ACCOUNTANT", assigneeId: "accountant" },
    { role: "CEO", assigneeId: "ceo" },
  ]);
});

test("ordinary approval projection keeps a missing direct manager visible", () => {
  assert.deepEqual(ordinaryApprovalSteps({
    directManagerId: null,
    accountantId: "accountant",
    ceoId: "ceo",
  })[0], { role: "MANAGER", assigneeId: "" });
});
