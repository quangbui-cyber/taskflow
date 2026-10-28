import type { WorkbookInventory } from "./workbookInventory";

export const MAPPABLE_FIELDS = ["name", "description", "sell.unit", "sell.quantity", "sell.days", "sell.unitPrice", "sell.vatPercent", "sell.basis", "sell.note", "buy.unit", "buy.quantity", "buy.days", "buy.unitPrice", "buy.vatPercent", "buy.basis", "buy.supplier", "buy.note"] as const;
export type MappableField = typeof MAPPABLE_FIELDS[number];
export type ExcelMappingProposal = {
  sheet: string; range: string; headerRow: number; kind: "QUOTATION" | "IC" | "PAIRED";
  columns: Partial<Record<MappableField, number>>;
  rows: { row: number; rowType: "GROUP" | "ITEM"; level: 1 | 2 | 3; parentRow: number | null }[];
  confidence: number;
};
export type ReviewedExcelMapping = ExcelMappingProposal & { reviewed: true; confirmedCriticalCells: string[] };

export function confidenceTier(confidence: number): "PRESELECTED" | "CONFIRM" | "UNMAPPED" {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Độ tin cậy mapping không hợp lệ.");
  return confidence >= 0.9 ? "PRESELECTED" : confidence >= 0.6 ? "CONFIRM" : "UNMAPPED";
}

export function validateExcelMapping(inventory: WorkbookInventory, proposal: ExcelMappingProposal) {
  const allowedKeys = new Set(["sheet", "range", "headerRow", "kind", "columns", "rows", "confidence", "reviewed", "confirmedCriticalCells"]);
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal) || Object.keys(proposal).some(key => !allowedKeys.has(key))) throw new Error("Cấu trúc mapping không hợp lệ.");
  const sheet = inventory.sheets.find(item => item.name === proposal.sheet);
  if (!sheet) throw new Error("Mapping tham chiếu sheet ngoài phạm vi đã kiểm tra.");
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(proposal.range);
  if (!match || !Number.isSafeInteger(proposal.headerRow)) throw new Error("Vùng mapping không hợp lệ.");
  const columnIndex = (name: string) => [...name.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
  const firstColumn = columnIndex(match[1]); const lastColumn = columnIndex(match[3]);
  const firstRow = Number(match[2]); const lastRow = Number(match[4]);
  if (firstRow < sheet.firstRow || lastRow > sheet.lastRow || firstColumn < sheet.firstColumn || lastColumn > sheet.lastColumn ||
      firstRow > lastRow || firstColumn > lastColumn || proposal.headerRow < firstRow || proposal.headerRow >= lastRow ||
      lastRow - proposal.headerRow > 500 || lastColumn - firstColumn + 1 > 40) throw new Error("Vùng mapping vượt phạm vi nguồn.");
  if (!["QUOTATION", "IC", "PAIRED"].includes(proposal.kind)) throw new Error("Loại bảng mapping không hợp lệ.");
  const keys = Object.keys(proposal.columns);
  if (!keys.includes("name") || keys.some(key => !MAPPABLE_FIELDS.includes(key as MappableField))) throw new Error("Mapping thiếu tên hoặc có field lạ.");
  const columns = Object.values(proposal.columns);
  if (columns.some(column => !Number.isSafeInteger(column) || column! < firstColumn || column! > lastColumn || sheet.hiddenColumns.includes(column!)) || new Set(columns).size !== columns.length) throw new Error("Cột mapping ngoài phạm vi hoặc bị ẩn.");
  if (!Array.isArray(proposal.rows) || proposal.rows.length === 0 || proposal.rows.length > 500 || proposal.rows.some(item =>
      !Number.isSafeInteger(item.row) || item.row <= proposal.headerRow || item.row > lastRow || sheet.hiddenRows.includes(item.row) ||
      !["GROUP", "ITEM"].includes(item.rowType) || ![1, 2, 3].includes(item.level) ||
      (item.parentRow !== null && (!Number.isSafeInteger(item.parentRow) || item.parentRow >= item.row || item.parentRow <= proposal.headerRow)))) throw new Error("Dòng hoặc hierarchy mapping không hợp lệ.");
  if (new Set(proposal.rows.map(item => item.row)).size !== proposal.rows.length) throw new Error("Dòng mapping bị lặp.");
  const selectedRows = new Set(proposal.rows.map(item => item.row));
  if (proposal.rows.some(item => item.parentRow !== null && !selectedRows.has(item.parentRow))) throw new Error("Dòng cha mapping không nằm trong bảng.");
  return { sheet, tier: confidenceTier(proposal.confidence) };
}
