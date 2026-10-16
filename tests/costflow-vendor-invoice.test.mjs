import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeVendorInvoice, validateVendorInvoiceFile } from "../lib/costflow/vendorInvoice.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");

for (const model of ["VendorInvoice", "VendorInvoiceFile", "VendorInvoiceActualCost", "VendorInvoiceApplication"]) {
  test(`schema defines ${model}`, () => assert.match(schema, new RegExp(`model ${model} \\{`)));
}

test("normalizes one VAT invoice identity and reconciles VND totals", () => {
  const invoice = normalizeVendorInvoice({ invoiceNumber: " 000123 ", symbol: " 1C26TAA ", issuedAt: "2026-10-16", sellerTaxCode: "0312345678", netAmount: "1000000", vatAmount: "100000", grossAmount: "1100000" });
  assert.equal(invoice.businessKey, "0312345678|1C26TAA|000123|2026-10-16");
  assert.equal(invoice.grossAmount, "1100000");
  assert.throws(() => normalizeVendorInvoice({ ...invoice, grossAmount: "1200000" }), /net \+ VAT/i);
});

test("accepts one XML and one PDF format but rejects signature or MIME substitution", () => {
  const xml = validateVendorInvoiceFile({ name: "invoice.xml", mimeType: "application/xml", size: 19, data: new TextEncoder().encode("<?xml version='1.0'") });
  const pdf = validateVendorInvoiceFile({ name: "invoice.pdf", mimeType: "application/pdf", size: 8, data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) });
  assert.equal(xml.format, "XML");
  assert.equal(pdf.format, "PDF");
  assert.throws(() => validateVendorInvoiceFile({ name: "invoice.pdf", mimeType: "application/pdf", size: 4, data: new Uint8Array([1, 2, 3, 4]) }), /chữ ký file PDF/i);
  assert.throws(() => validateVendorInvoiceFile({ name: "invoice.xml", mimeType: "text/plain", size: 5, data: new TextEncoder().encode("<xml>") }), /MIME/i);
});
