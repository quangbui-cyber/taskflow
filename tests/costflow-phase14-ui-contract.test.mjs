import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Phase 14 UI exposes shared supplier, pre-AC DNTU and post-AC VAT DNTT boundaries", () => {
  const supplier = source("components/costflow/suppliers/SupplierDirectory.tsx");
  const payment = source("components/costflow/payments/PaymentRequestEditor.tsx");
  const invoice = source("components/costflow/payments/VendorInvoiceEditor.tsx");
  assert.match(supplier, /Danh bạ NCC toàn công ty/);
  assert.match(payment, /ĐNTU trước AC/);
  assert.match(payment, /ĐNTT sau AC/);
  assert.match(invoice, /XML/);
  assert.match(invoice, /PDF/);
  assert.match(invoice, /accept=.*\.xml.*\.pdf/i);
});

test("legacy surfaces stay readable without any project-local write command", () => {
  const files = [
    "components/ExpenseDetailDrawer.tsx",
    "components/ExpenseRequestModal.tsx",
    "components/ExpenseUploadModal.tsx",
    "components/InternalCostPanel.tsx",
    "components/PairedQuotationIcEditor.tsx",
    "components/PaymentCashPanel.tsx",
  ];
  const combined = files.map(source).join("\n");
  assert.match(combined, /chỉ đọc/);
  assert.doesNotMatch(combined, /command="(?:BENEFICIARY|EXPENSE|EXPENSE_EVIDENCE|REVISE_EXPENSE)"/);
  assert.match(combined, /\/suppliers/);
});

test("release verifier and operator guide fail closed at environment and human gates", () => {
  const verifier = source("scripts/verify-phase14-release.mjs");
  const guide = source("docs/COSTFLOW_SUPPLIER_PAYMENT.md");
  assert.match(verifier, /postgresql:\/\/postgres@127\.0\.0\.1:55439\/costflow_test/);
  assert.match(verifier, /port !== 3017/);
  assert.match(verifier, /RELEASE_VERDICT.*NOT_READY/);
  assert.match(verifier, /browser_local/);
  for (const term of ["xung đột migrate", "file ngân hàng không bắt buộc", "ĐNTU", "ĐNTT", "XML", "PDF", "rollback", "Expense legacy", "API ngân hàng", "company acceptance"]) {
    assert.ok(guide.toLowerCase().includes(term.toLowerCase()), `missing ${term}`);
  }
});
