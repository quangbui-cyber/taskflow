import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

test("active financial consumers no longer read the historical Expense JSON array", () => {
  const consumers = [
    "components/CostFlowPanel.tsx",
    "components/ExpenseRequestModal.tsx",
    "components/PaymentCashPanel.tsx",
    "components/costflow/navigation/FinancialLifecycleBar.tsx",
    "components/costflow/navigation/CostFlowActionBanner.tsx",
    "lib/costflow/pairedService.ts",
    "lib/costflow/reconciliation.ts",
  ];
  for (const file of consumers) assert.doesNotMatch(source(file), /(?:finance\.)?data\.expenses/);
  assert.match(source("components/ExpenseRequestModal.tsx"), /finance\.actualCosts\?\.lines/);
  assert.match(source("components/PaymentCashPanel.tsx"), /finance\.actualCosts\?\.lines/);
});

test("legacy entry components and normalization are removed while persisted data has a read-only verifier", () => {
  for (const file of [
    "components/ExpenseUploadModal.tsx",
    "components/ExpenseDetailDrawer.tsx",
    "components/costflow/actual-cost/ActualCostEditor.tsx",
    "components/costflow/actual-cost/ActualCostTable.tsx",
  ]) assert.equal(existsSync(fileURLToPath(new URL(file, root))), false, file);
  assert.doesNotMatch(source("lib/costflow/actualCost.ts"), /normalizeLegacyActualCosts/);
  assert.match(source("lib/costflow/types.ts"), /Historical persisted rows only/);
  const verifier = source("scripts/verify-expense-legacy-cutover.mjs");
  assert.match(verifier, /mode: "read-only"/);
  assert.match(verifier, /cleanupPerformed: false/);
  assert.doesNotMatch(verifier, /DELETE|UPDATE|TRUNCATE/i);
});

test("server action accepts only whole-sheet submit and decision commands", () => {
  const action = source("app/actions/costflow.ts");
  const service = source("lib/costflow/actualCostService.ts");
  assert.match(action, /\["CREATE_AND_SUBMIT", "RESUBMIT", "DECIDE", "BULK_DECIDE"\]/);
  assert.match(action, /action === "SUBMIT_SHEET"/);
  assert.match(action, /action === "DECIDE_SHEET"/);
  assert.match(action, /action === "UPDATE_LINES_STATUS"/);
  assert.match(service, /\["CREATE_AND_SUBMIT", "RESUBMIT", "DECIDE"\]\.includes\(command\.command\)/);
  assert.match(service, /thao tác duyệt nhiều khoản riêng lẻ đã ngừng sử dụng/);
});

test("rendered Bảng AC copy uses business Vietnamese", () => {
  const rendered = [
    source("components/ActualCostPanel.tsx"),
    source("components/ApprovalRequestsPanel.tsx"),
    source("components/costflow/actual-cost/ActualCostSheetView.tsx"),
    source("components/costflow/actual-cost/ActualCostDetailDrawer.tsx"),
    source("components/costflow/actual-cost/ActualCostPreflightModal.tsx"),
    source("components/costflow/actual-cost/ActualCostDecisionBar.tsx"),
  ].join("\n");
  for (const label of ["Bảng AC – Tổng hợp thực chi", "Kiểm tra trước khi gửi", "Duyệt toàn bộ Bảng AC", "Phó Giám đốc"]) {
    assert.match(rendered, new RegExp(label));
  }
  assert.doesNotMatch(rendered, />\s*(?:AC_DD|Atomic Project AC Sheet|Preflight Check|IC baseline)\s*</);
});
