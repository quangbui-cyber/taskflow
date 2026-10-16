import { createHash } from "node:crypto";
import { MAX_PROJECT_FILE_SIZE, type ProjectUpload } from "@/lib/projectFiles";

export type VendorInvoiceMetadata = {
  invoiceNumber: string;
  symbol: string;
  issuedAt: string;
  sellerTaxCode: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
};

const required = (value: string, label: string, max = 120) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`Thiếu ${label}.`);
  if (normalized.length > max) throw new Error(`${label} quá dài.`);
  return normalized;
};

const vnd = (value: string, label: string) => {
  const normalized = required(value, label, 30);
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} phải là số nguyên VND không âm.`);
  return BigInt(normalized).toString();
};

export function normalizeVendorInvoice(input: VendorInvoiceMetadata) {
  const invoiceNumber = required(input.invoiceNumber, "số hóa đơn").toUpperCase();
  const symbol = required(input.symbol, "ký hiệu hóa đơn").replace(/\s+/g, "").toUpperCase();
  const sellerTaxCode = required(input.sellerTaxCode, "MST người bán", 30).replace(/[^0-9-]/g, "");
  const issuedAt = required(input.issuedAt, "ngày hóa đơn", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt) || new Date(`${issuedAt}T00:00:00.000Z`).toISOString().slice(0, 10) !== issuedAt) throw new Error("Ngày hóa đơn không hợp lệ.");
  const netAmount = vnd(input.netAmount, "tiền trước VAT");
  const vatAmount = vnd(input.vatAmount, "tiền VAT");
  const grossAmount = vnd(input.grossAmount, "tổng tiền");
  if (BigInt(netAmount) + BigInt(vatAmount) !== BigInt(grossAmount)) throw new Error("Tổng tiền phải bằng net + VAT.");
  return { invoiceNumber, symbol, issuedAt, sellerTaxCode, netAmount, vatAmount, grossAmount, businessKey: `${sellerTaxCode}|${symbol}|${invoiceNumber}|${issuedAt}` };
}

export function validateVendorInvoiceFile(upload: ProjectUpload) {
  if (upload.size <= 0 || upload.size !== upload.data.byteLength || upload.size > MAX_PROJECT_FILE_SIZE) throw new Error("File hóa đơn phải có dữ liệu và nhỏ hơn 4 MB.");
  const extension = upload.name.slice(upload.name.lastIndexOf(".")).toLowerCase();
  if (extension === ".pdf") {
    if (upload.mimeType !== "application/pdf") throw new Error("MIME của file PDF không hợp lệ.");
    if (String.fromCharCode(...upload.data.slice(0, 5)) !== "%PDF-") throw new Error("Không tìm thấy chữ ký file PDF.");
    return { format: "PDF" as const, name: upload.name, mimeType: upload.mimeType, byteLength: upload.size, sha256: createHash("sha256").update(upload.data).digest("hex"), data: upload.data };
  }
  if (extension === ".xml") {
    if (!["application/xml", "text/xml"].includes(upload.mimeType)) throw new Error("MIME của file XML không hợp lệ.");
    const prefix = new TextDecoder().decode(upload.data.slice(0, 256)).replace(/^\uFEFF/, "").trimStart();
    if (!prefix.startsWith("<?xml") && !prefix.startsWith("<")) throw new Error("Không tìm thấy cấu trúc XML hóa đơn.");
    return { format: "XML" as const, name: upload.name, mimeType: upload.mimeType, byteLength: upload.size, sha256: createHash("sha256").update(upload.data).digest("hex"), data: upload.data };
  }
  throw new Error("Hóa đơn điện tử chỉ hỗ trợ XML hoặc PDF.");
}

export function assertSameVendorInvoice(left: ReturnType<typeof normalizeVendorInvoice>, right: ReturnType<typeof normalizeVendorInvoice>) {
  if (left.businessKey !== right.businessKey || left.netAmount !== right.netAmount || left.vatAmount !== right.vatAmount || left.grossAmount !== right.grossAmount) throw new Error("XML và PDF không cùng metadata của một hóa đơn.");
  return left;
}
