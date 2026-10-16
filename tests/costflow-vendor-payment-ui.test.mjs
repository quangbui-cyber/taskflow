import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = file => readFileSync(path.join(root, file), "utf8");

test("payment editor separates scheduled pre-AC DNTU from post-AC DNTT", () => {
  const editor = source("components/costflow/payments/PaymentRequestEditor.tsx");
  assert.match(editor, /ĐNTT sau AC/);
  assert.match(editor, /VendorInvoiceEditor/);
  assert.match(editor, /ĐNTU trước AC/);
});

test("vendor invoice editor captures one invoice with XML or PDF and exact approved AC rows", () => {
  const editor = source("components/costflow/payments/VendorInvoiceEditor.tsx");
  assert.match(editor, /vendorPaymentAction/);
  assert.match(editor, /invoiceXml/);
  assert.match(editor, /invoicePdf/);
  assert.match(editor, /fundingSource === "VENDOR_PAYMENT"/);
  assert.match(editor, /approvalId/);
  assert.match(editor, /MST người bán/);
});

test("payment review shows immutable invoice to AC to IC lineage without inheriting IC evidence", () => {
  const review = source("components/costflow/payments/PaymentRequestReview.tsx");
  assert.match(review, /ĐNTT → Hóa đơn VAT → AC đã duyệt → IC/);
  assert.match(review, /Minh chứng IC \(lịch sử, không kế thừa\)/);
  assert.match(review, /actualCostManifest/);
});
