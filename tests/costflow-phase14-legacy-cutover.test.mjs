import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { calculateLineCost } from "../lib/costflow/money.ts";
import { normalizeLegacyActualCosts } from "../lib/costflow/actualCost.ts";

const root = path.resolve(import.meta.dirname, "..");
const source = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("legacy Expense commands fail before the finance transaction can mutate data", () => {
  const service = source("lib/costflow/service.ts");
  const functionStart = service.indexOf("export async function executeFinance");
  const transactionStart = service.indexOf("return prisma.$transaction", functionStart);
  const guardStart = service.indexOf("assertLegacyExpenseReadOnly", functionStart);

  assert.ok(functionStart >= 0 && guardStart > functionStart && guardStart < transactionStart);
  assert.doesNotMatch(service, /case "(?:EXPENSE|EXPENSE_EVIDENCE|REVISE_EXPENSE)"/);
  assert.match(service, /LEGACY_EXPENSE_WRITE_COMMANDS/);
  assert.match(service, /Expense legacy chỉ đọc/);
});

test("legacy expense UI is historical inspection and download only", () => {
  const drawer = source("components/ExpenseDetailDrawer.tsx");
  const uploadModal = source("components/ExpenseUploadModal.tsx");

  assert.doesNotMatch(drawer, /EXPENSE_EVIDENCE|REVISE_EXPENSE|costFlowAction|ActionForm/);
  assert.match(drawer, /chỉ đọc/i);
  assert.doesNotMatch(uploadModal, /form\.append\("command", "EXPENSE"\)|costFlowAction/);
  assert.match(uploadModal, /AC chuẩn hóa/i);
});

test("historical Expense fixtures remain readable with their immutable evidence aliases", () => {
  const cost = calculateLineCost({ quantity: "2", days: "1", unitPrice: "550", basis: "GROSS", vatPercent: "10" });
  const legacy = Object.freeze({
    id: "expense-old-1",
    revisionId: "ic-old-1",
    lineId: "ic-line-old-1",
    recipientKey: "VENDOR:legacy-vendor",
    description: "Chi phí lịch sử",
    input: Object.freeze({ quantity: "2", unitPrice: "550", basis: "GROSS", vatPercent: "10" }),
    cost: Object.freeze(cost),
    invoiceId: "legacy-invoice-evidence",
    paymentProofId: "legacy-payment-evidence",
    createdBy: "account-old",
  });

  const before = JSON.stringify(legacy);
  const [line] = normalizeLegacyActualCosts([legacy]);
  assert.equal(line.source, "legacy");
  assert.equal(line.amount, cost.gross);
  assert.equal(line.revisionId, legacy.revisionId);
  assert.equal(line.icLineId, legacy.lineId);
  assert.equal(JSON.stringify(legacy), before);

  const types = source("lib/costflow/types.ts");
  assert.match(types, /LegacyExpense = Readonly/);
  assert.match(types, /invoiceId: string \| null/);
  assert.match(types, /paymentProofId: string \| null/);
});
