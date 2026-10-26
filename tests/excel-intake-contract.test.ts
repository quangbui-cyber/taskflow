import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_EXCEL_INTAKE_FIELDS,
  EXCEL_INTAKE_SCHEMA_VERSION,
  normalizeExcelIntake,
  projectCustomerExcelIntake,
  resolveExcelIntakeDecimalConflicts,
  type ExcelIntakeRowInput,
} from "../lib/costflow/excelIntake";
import { readFile } from "node:fs/promises";
import path from "node:path";

const cell = (value: unknown, row: number, column: number, formula?: string) => ({
  value,
  source: { sheet: "BAO_GIA_IC", row, column, cell: `${String.fromCharCode(64 + column)}${row}` },
  ...(formula ? { observation: { formula, cachedValue: "999999" } } : {}),
});

const pairedCell = (visible: unknown, canonical: string, row: number, column: number) => ({
  ...cell(visible, row, column),
  canonical: {
    value: canonical,
    source: { sheet: "_IMPORT", row: row - 5, column, cell: `${String.fromCharCode(64 + column)}${row - 5}` },
  },
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

test("hybrid decimals keep canonical exact values and emit stable per-cell conflicts", () => {
  const exact = item({
    sell: {
      ...item().sell,
      quantity: pairedCell(9007199254740992, "9007199254740993", 8, 7),
      days: pairedCell(0.3333333333333333, "0.333333333333333333333333", 8, 8),
      unitPrice: pairedCell(0, "0", 8, 9),
      vatPercent: pairedCell(0, "0", 8, 10),
    },
  });
  const normalized = normalizeExcelIntake(document([group, exact]));
  assert.equal(normalized.rows[1].sell.quantity, "9007199254740993");
  assert.equal(normalized.rows[1].sell.days, "0.333333333333333333333333");
  assert.equal(normalized.rows[1].sell.unitPrice, "0");
  assert.equal(normalized.rows[1].sell.vatPercent, "0");
  assert.deepEqual(normalized.decimalConflicts.map(conflict => [conflict.field, conflict.visible, conflict.canonical, conflict.source.cell]), [
    ["sell.quantity", "9007199254740992", "9007199254740993", "G8"],
    ["sell.days", "0.3333333333333333", "0.333333333333333333333333", "H8"],
  ]);
  assert.equal(new Set(normalized.decimalConflicts.map(conflict => conflict.conflictId)).size, 2);
});

test("Excel decimal parser accepts unambiguous Vietnamese/canonical notation and blocks ambiguous separators", () => {
  const localized = item({ sell: { ...item().sell, quantity: cell("1.234,56", 8, 7), days: cell("1234.56", 8, 8), unitPrice: cell("1,234", 8, 9) } });
  const normalized = normalizeExcelIntake(document([group, localized]));
  assert.equal(normalized.rows[1].sell.quantity, "1234.56");
  assert.equal(normalized.rows[1].sell.days, "1234.56");
  assert.ok(normalized.errors.some(error => error.code === "AMBIGUOUS_DECIMAL" && error.field === "sell.unitPrice"));
});

test("server resolution requires exactly one choice per conflict and overlays the selected exact value", () => {
  const normalized = normalizeExcelIntake(document([group, item({ sell: { ...item().sell, quantity: pairedCell(2, "2.0000000000001", 8, 7) } })]));
  const [conflict] = normalized.decimalConflicts;
  assert.throws(() => resolveExcelIntakeDecimalConflicts(normalized, {}), /đầy đủ|thiếu/i);
  assert.throws(() => resolveExcelIntakeDecimalConflicts(normalized, { [conflict.conflictId]: "OTHER" as "VISIBLE" }), /không hợp lệ/i);
  assert.throws(() => resolveExcelIntakeDecimalConflicts(normalized, { [conflict.conflictId]: "VISIBLE", forged: "CANONICAL" }), /không hợp lệ/i);
  assert.equal(resolveExcelIntakeDecimalConflicts(normalized, { [conflict.conflictId]: "VISIBLE" }).rows[1].sell.quantity, "2");
  assert.equal(resolveExcelIntakeDecimalConflicts(normalized, { [conflict.conflictId]: "CANONICAL" }).rows[1].sell.quantity, "2.0000000000001");
});

test("both dialogs expose per-cell visible/canonical choices and send decimal resolutions", async () => {
  for (const file of ["ExcelIntakeDialog.tsx", "ExcelRoundTripDialog.tsx"]) {
    const source = await readFile(path.join(process.cwd(), "components", file), "utf8");
    assert.match(source, /decimalResolutions/);
    assert.match(source, /Dùng giá trị hiển thị/);
    assert.match(source, /Giữ giá trị chính xác/);
    assert.match(source, /conflict\.source\.cell/);
  }
});
