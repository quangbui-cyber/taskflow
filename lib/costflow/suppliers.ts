import { createHash } from "node:crypto";

function collapse(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSupplierName(value: string) {
  return collapse(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, match => match === "Đ" ? "D" : "d")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizeSupplierTaxCode(value?: string | null) {
  const normalized = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized || null;
}

export function normalizeBankName(value: string) {
  return normalizeSupplierName(value);
}

export function normalizeAccountNumber(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function supplierAccountFingerprint(bankName: string, accountNumber: string) {
  return createHash("sha256")
    .update(`${normalizeBankName(bankName)}\u0000${normalizeAccountNumber(accountNumber)}`)
    .digest("hex");
}

export function supplierDedupeKey(input: { name: string; taxCode?: string | null; bank: string; account: string }) {
  const taxCode = normalizeSupplierTaxCode(input.taxCode);
  if (taxCode) return `TAX:${taxCode}`;
  return `NAME_ACCOUNT:${normalizeSupplierName(input.name)}:${supplierAccountFingerprint(input.bank, input.account)}`;
}

export function maskedAccountLast4(accountNumber: string) {
  return normalizeAccountNumber(accountNumber).slice(-4);
}

