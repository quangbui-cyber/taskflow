import { createHash } from "node:crypto";
import { EXCEL_INTAKE_SCHEMA_VERSION, normalizeExcelIntake, type ExcelIntakeInput, type ExcelIntakePrimitiveCell } from "@/lib/costflow/excelIntake";
import type { ExcelIntakePreview } from "@/lib/costflow/excelIntakeParser";
import { cellAddress, inventoryCell, type WorkbookInventory } from "./workbookInventory";
import { validateExcelMapping, type MappableField, type ReviewedExcelMapping } from "./mapping";

const criticalFields = new Set<MappableField>(["sell.quantity", "sell.days", "sell.unitPrice", "sell.vatPercent", "buy.quantity", "buy.days", "buy.unitPrice", "buy.vatPercent"]);
function primitive(value: unknown, sheet: string, row: number, column: number): ExcelIntakePrimitiveCell {
  return { value: value ?? "", source: { sheet, row, column, cell: cellAddress(row, column) } };
}

function rebuildOne(inventory: WorkbookInventory, mapping: ReviewedExcelMapping): ExcelIntakeInput {
  if (mapping.reviewed !== true) throw new Error("Cần xác nhận mapping trước khi xem trước Excel Intake.");
  const { sheet, tier } = validateExcelMapping(inventory, mapping);
  if (tier === "UNMAPPED") throw new Error("Mapping dưới ngưỡng 0.60 cần nhập thủ công.");
  const confirmed = new Set(mapping.confirmedCriticalCells);
  const fallbackColumn = mapping.columns.name!;
  const field = (row: number, name: MappableField) => {
    const column = mapping.columns[name];
    if (column === undefined) return primitive("", sheet.name, row, fallbackColumn);
    const source = inventoryCell(sheet, row, column);
    if (source?.formula !== undefined) throw new Error(`Ô ${source.address} chứa công thức; giá trị cache không thể làm nguồn chính.`);
    if (criticalFields.has(name) && source?.value !== undefined && source.value !== null && String(source.value).trim() !== "" && !confirmed.has(`${sheet.name}!${cellAddress(row, column)}`)) {
      throw new Error(`Cần xác nhận ô trọng yếu ${sheet.name}!${cellAddress(row, column)} từ nguồn gốc.`);
    }
    const value = source?.value;
    if (value !== null && value !== undefined && !["string", "number", "boolean"].includes(typeof value) && !(value instanceof Date)) {
      throw new Error(`Ô ${cellAddress(row, column)} không có giá trị nguyên thủy.`);
    }
    return primitive(value instanceof Date ? value.toISOString().slice(0, 10) : value, sheet.name, row, column);
  };
  const rows = [...mapping.rows].sort((a, b) => a.row - b.row).map(item => ({
    level: primitive(item.level, sheet.name, item.row, fallbackColumn),
    rowType: primitive(item.rowType, sheet.name, item.row, fallbackColumn),
    parentRow: primitive(item.parentRow ?? "", sheet.name, item.row, fallbackColumn),
    name: field(item.row, "name"), description: field(item.row, "description"),
    sell: { unit: field(item.row, "sell.unit"), quantity: field(item.row, "sell.quantity"), days: field(item.row, "sell.days"), unitPrice: field(item.row, "sell.unitPrice"), vatPercent: field(item.row, "sell.vatPercent"), basis: field(item.row, "sell.basis"), note: field(item.row, "sell.note") },
    buy: { unit: field(item.row, "buy.unit"), quantity: field(item.row, "buy.quantity"), days: field(item.row, "buy.days"), unitPrice: field(item.row, "buy.unitPrice"), vatPercent: field(item.row, "buy.vatPercent"), basis: field(item.row, "buy.basis"), note: field(item.row, "buy.note"), supplier: field(item.row, "buy.supplier") },
  }));
  return { schemaVersion: EXCEL_INTAKE_SCHEMA_VERSION, source: { kind: "XLSX", sheet: sheet.name, range: mapping.range },
    metadata: { projectName: "", customer: "", preparedAt: "", location: "" }, rows };
}

export function rebuildExcelIntakeInput(inventory: WorkbookInventory, mapping: ReviewedExcelMapping): ExcelIntakeInput {
  const primary = rebuildOne(inventory, { ...mapping, additional: undefined });
  if (!mapping.additional) return primary;
  validateExcelMapping(inventory, mapping);
  const additional = rebuildOne(inventory, { ...mapping.additional, reviewed: true,
    confirmedCriticalCells: mapping.confirmedCriticalCells });
  return { ...primary, source: { kind: "XLSX", sheet: "WORKBOOK", range: `${mapping.sheet}!${mapping.range};${mapping.additional.sheet}!${mapping.additional.range}` },
    rows: [...primary.rows, ...additional.rows] };
}

export function previewReviewedExcelMapping(inventory: WorkbookInventory, mapping: ReviewedExcelMapping): ExcelIntakePreview {
  const input = rebuildExcelIntakeInput(inventory, mapping);
  const normalized = normalizeExcelIntake(input);
  const fingerprint = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  const excluded = [] as string[];
  for (const table of [mapping, mapping.additional].filter((item): item is NonNullable<typeof item> => Boolean(item))) {
  const sheet = inventory.sheets.find(item => item.name === table.sheet)!;
  const includedRows = new Set(table.rows.map(item => item.row));
  for (let row = table.headerRow + 1; row <= sheet.lastRow; row++) {
    if (includedRows.has(row)) continue;
    const cells = [...sheet.cells.values()].filter(cell => cell.row === row);
    if (!cells.length) continue;
    const text = cells.filter(cell => typeof cell.value === "string").map(cell => String(cell.value).trim().toLowerCase());
    const reason = sheet.hiddenRows.includes(row) ? "HIDDEN_ROW" :
      text.some(value => /^(tổng|tổng cộng|total|subtotal)\b/.test(value)) ? "TOTAL" :
      text.some(value => /^(name|tên hạng mục|hạng mục|description|mô tả)$/.test(value)) ? "REPEATED_HEADER" :
      text.some(value => /^(ghi chú|note|chú thích)\b/.test(value)) ? "NOTE" : "UNMAPPED";
    excluded.push(`${sheet.name}!${row}: ${reason} (${cells.map(cell => cell.address).join(",")})`);
  }
  }
  return { ...normalized, fingerprint, adapter: "AI_REVIEWED", confidence: Math.min(mapping.confidence, mapping.additional?.confidence ?? 1),
    mappingProvenance: { version: inventory.version, fingerprint: inventory.fingerprint, runId: mapping.runId ?? null, adapterId: mapping.adapterId ?? null,
      confirmedCriticalCells: [...mapping.confirmedCriticalCells].sort(), reviewed: true },
    mappingProposal: { sheet: mapping.sheet, range: mapping.range, headerRow: mapping.headerRow, kind: mapping.kind,
      columns: mapping.columns, rows: mapping.rows, confidence: mapping.confidence, additional: mapping.additional },
    mappingObservations: [...inventory.observations, ...excluded] };
}
