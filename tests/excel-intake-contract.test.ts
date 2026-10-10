import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_EXCEL_INTAKE_FIELDS,
  EXCEL_INTAKE_SCHEMA_VERSION,
  normalizeExcelIntake,
  projectCustomerExcelIntake,
  type ExcelIntakeRowInput,
} from "../lib/costflow/excelIntake";

const cell = (value: unknown, row: number, column: number, formula?: string) => ({
  value,
  source: { sheet: "BAO_GIA_IC", row, column, cell: `${String.fromCharCode(64 + column)}${row}` },
  ...(formula ? { observation: { formula, cachedValue: "999999" } } : {}),
});

function item(overrides: Partial<ExcelIntakeRowInput> = {}): ExcelIntakeRowInput {
  return {
    level: cell(2, 8, 1),
    rowType: cell("ITEM", 8, 2),
    parentRow: cell(7, 8, 3),
    name: cell("Hạng mục mẫu", 8, 4),
    description: cell("Mô tả công khai", 8, 5),
    sell: {
      unit: cell("ngày", 8, 6), quantity: cell("2", 8, 7), days: cell("1,5", 8, 8),
      unitPrice: cell("0", 8, 9), vatPercent: cell("8", 8, 10), basis: cell("NET", 8, 11), note: cell("FOC theo thỏa thuận", 8, 12),
    },
    buy: {
      unit: cell("ngày", 8, 13), quantity: cell("", 8, 14), days: cell("", 8, 15),
      unitPrice: cell("1250,50", 8, 16), vatPercent: cell("10", 8, 17), basis: cell("GROSS", 8, 18),
      supplier: cell("NCC nội bộ", 8, 19), note: cell("Ghi chú IC", 8, 20),
    },
    previewNet: cell("999999", 8, 21, "G8*H8*I8"),
    ...overrides,
  };
}

const group: ExcelIntakeRowInput = {
  level: cell(1, 7, 1), rowType: cell("GROUP", 7, 2), parentRow: cell("", 7, 3),
  name: cell("Nhóm A", 7, 4), description: cell("", 7, 5),
  sell: { unit: cell("", 7, 6), quantity: cell("", 7, 7), days: cell("", 7, 8), unitPrice: cell("", 7, 9), vatPercent: cell("", 7, 10), basis: cell("", 7, 11), note: cell("", 7, 12) },
  buy: { unit: cell("", 7, 13), quantity: cell("", 7, 14), days: cell("", 7, 15), unitPrice: cell("", 7, 16), vatPercent: cell("", 7, 17), basis: cell("", 7, 18), supplier: cell("", 7, 19), note: cell("", 7, 20) },
};

function document(rows: ExcelIntakeRowInput[] = [group, item()]) {
  return {
    schemaVersion: 4,
    source: { kind: "XLSX" as const, sheet: "BAO_GIA_IC", range: "A1:U50" },
    metadata: { projectName: "Project", customer: "Customer", preparedAt: "2026-10-10", location: "TP.HCM" },
    rows,
  };
}

test("v4 normalization keeps exact coordinates, blank versus zero and independent sides", () => {
  assert.equal(EXCEL_INTAKE_SCHEMA_VERSION, 4);
  const normalized = normalizeExcelIntake(document());
  assert.equal(normalized.schemaVersion, 4);
  assert.deepEqual(normalized.source, { kind: "XLSX", sheet: "BAO_GIA_IC", range: "A1:U50" });
  assert.equal(normalized.rows[1].candidateKey, "candidate-2");
  assert.equal(normalized.rows[1].parentCandidateKey, "candidate-1");
  assert.equal(normalized.rows[1].sell.days, "1.5");
  assert.equal(normalized.rows[1].buy.days, null);
  assert.equal(normalized.rows[1].sell.unitPrice, "0");
  assert.equal(normalized.rows[1].buy.unitPrice, "1250.5");
  assert.deepEqual(normalized.rows[1].coordinates.sellDays, { sheet: "BAO_GIA_IC", row: 8, column: 8, cell: "H8" });
  assert.equal(normalized.observations[0].formula, "G8*H8*I8");
  assert.ok(!JSON.stringify(normalized.rows).includes("999999"), "formula totals never become canonical values");
  assert.deepEqual(normalized.errors, []);
});

test("invalid schema, basis, VAT, days, FOC and hierarchy produce blocking field diagnostics", () => {
  assert.throws(() => normalizeExcelIntake({ ...document(), schemaVersion: 3 }), /schemaVersion 4/);
  const invalid = item({
    level: cell(3, 8, 1),
    parentRow: cell("", 8, 3),
    sell: { ...item().sell, days: cell("0", 8, 8), unitPrice: cell("0", 8, 9), note: cell("", 8, 12), vatPercent: cell("101", 8, 10) },
    buy: { ...item().buy, basis: cell("INVALID", 8, 18) },
  });
  const normalized = normalizeExcelIntake(document([invalid]));
  assert.deepEqual(new Set(normalized.errors.map(error => error.code)), new Set(["INVALID_HIERARCHY", "INVALID_DAYS", "INVALID_VAT", "INVALID_BASIS", "FOC_NOTE_REQUIRED"]));
  for (const error of normalized.errors) {
    assert.equal(error.blocking, true);
    assert.equal(error.source.sheet, "BAO_GIA_IC");
    assert.match(error.source.cell, /^[A-Z]+\d+$/);
  }
});

test("customer projection is allowlisted and rejects every private sentinel", () => {
  const normalized = normalizeExcelIntake(document());
  const customer = projectCustomerExcelIntake(normalized);
  assert.deepEqual(Object.keys(customer.rows[1]).sort(), [...CUSTOMER_EXCEL_INTAKE_FIELDS].sort());
  for (const token of ["NCC nội bộ", "Ghi chú IC", "candidate-2", "_IMPORT", "999999", "evidence"]) {
    assert.ok(!JSON.stringify(customer).includes(token), `customer projection leaked ${token}`);
  }
});
