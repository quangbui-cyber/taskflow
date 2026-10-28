import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { EXCEL_INTAKE_LIMITS, preflightExcelWorkbook, type ExcelWorkbookUpload } from "@/lib/costflow/excelIntakeSecurity";

export const EXCEL_MAPPING_VERSION = "phase15-excel-v1";
export type InventoryCell = { row: number; column: number; address: string; value: unknown; type: string; format: string; formula?: string; cachedValue?: unknown };
export type InventorySheet = {
  name: string; range: string; firstRow: number; lastRow: number; firstColumn: number; lastColumn: number;
  cells: Map<string, InventoryCell>; hiddenRows: number[]; hiddenColumns: number[]; mergedRanges: string[];
  formulaCells: string[]; tables: string[]; observations: string[];
};
export type WorkbookInventory = { version: typeof EXCEL_MAPPING_VERSION; fingerprint: string; sheets: InventorySheet[]; observations: string[] };

function columnName(column: number) { let number = column; let name = ""; while (number) { number--; name = String.fromCharCode(65 + number % 26) + name; number = Math.floor(number / 26); } return name; }
export const cellAddress = (row: number, column: number) => `${columnName(column)}${row}`;
export function inventoryCell(sheet: InventorySheet, row: number, column: number) { return sheet.cells.get(cellAddress(row, column)); }

export async function inventoryExcelWorkbook(bytes: Uint8Array, upload: ExcelWorkbookUpload): Promise<WorkbookInventory> {
  await preflightExcelWorkbook(bytes, upload);
  const workbook = new ExcelJS.Workbook();
  const copy = Buffer.from(bytes);
  await workbook.xlsx.load(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer);
  const candidates = workbook.worksheets.filter(sheet => sheet.state === "visible" && !/nhà cung cấp|supplier|evidence|chứng từ|_import/i.test(sheet.name) && sheet.actualRowCount > 0);
  const excludedSheets = workbook.worksheets.filter(sheet => !candidates.includes(sheet)).map(sheet =>
    `Excluded sheet ${sheet.name}: ${sheet.state !== "visible" ? "HIDDEN_SHEET" : "REFERENCE_OR_EMPTY"}`);
  if (candidates.length < 1 || candidates.length > 2) throw new Error("AI mapping chỉ nhận một workbook với tối đa hai sheet dữ liệu.");
  const sheets: InventorySheet[] = candidates.map(sheet => {
    const bounds = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(String(sheet.dimensions));
    if (!bounds) throw new Error("Vùng sheet không hợp lệ.");
    const firstRow = Number(bounds[2]); const lastRow = Number(bounds[4]);
    const firstColumn = sheet.getColumn(bounds[1]).number; const lastColumn = sheet.getColumn(bounds[3]).number;
    if (lastRow - firstRow > EXCEL_INTAKE_LIMITS.rows || lastColumn - firstColumn + 1 > EXCEL_INTAKE_LIMITS.columns) throw new Error("Vùng sheet vượt giới hạn Excel Intake.");
    const cells = new Map<string, InventoryCell>(); const hiddenRows: number[] = []; const hiddenColumns: number[] = [];
    const formulaCells: string[] = []; const observations: string[] = [];
    for (let column = firstColumn; column <= lastColumn; column++) if (sheet.getColumn(column).hidden) hiddenColumns.push(column);
    for (let row = firstRow; row <= lastRow; row++) {
      if (sheet.getRow(row).hidden) hiddenRows.push(row);
      for (let column = firstColumn; column <= lastColumn; column++) {
        const cell = sheet.getCell(row, column); if (cell.value === null || cell.value === undefined) continue;
        const address = cellAddress(row, column);
        const formula = cell.type === ExcelJS.ValueType.Formula ? cell.formula ?? "" : undefined;
        if (formula !== undefined) formulaCells.push(address);
        cells.set(address, { row, column, address, value: cell.value, type: ExcelJS.ValueType[cell.type] ?? String(cell.type), format: cell.numFmt ?? "", formula,
          cachedValue: formula !== undefined ? (cell.value as ExcelJS.CellFormulaValue).result : undefined });
      }
    }
    const mergedRanges = Object.keys((sheet as unknown as { _merges?: Record<string, unknown> })._merges ?? {});
    const tables = Object.keys((sheet as unknown as { tables?: Record<string, unknown> }).tables ?? {});
    if (tables.length > 2) throw new Error("AI mapping không hỗ trợ nhiều bảng lồng nhau.");
    if (hiddenRows.length) observations.push(`Hidden rows: ${hiddenRows.join(",")}`);
    if (hiddenColumns.length) observations.push(`Hidden columns: ${hiddenColumns.map(columnName).join(",")}`);
    if (mergedRanges.length) observations.push(`Merged ranges: ${mergedRanges.join(",")}`);
    if (formulaCells.length) observations.push(`Formula cells: ${formulaCells.join(",")}`);
    return { name: sheet.name, range: String(sheet.dimensions), firstRow, lastRow, firstColumn, lastColumn, cells, hiddenRows, hiddenColumns, mergedRanges, formulaCells, tables, observations };
  });
  const totalTables = sheets.reduce((count, sheet) => count + Math.max(1, sheet.tables.length), 0);
  if (totalTables > 2) throw new Error("AI mapping chỉ hỗ trợ tối đa một bảng mỗi loại.");
  const fingerprint = createHash("sha256").update(JSON.stringify(sheets.map(sheet => ({ name: sheet.name, range: sheet.range,
    types: [...sheet.cells.values()].filter(cell => cell.row <= sheet.firstRow + 20).map(({ row, column, type, format }) => [row, column, type, format]),
    merged: sheet.mergedRanges, hiddenRows: sheet.hiddenRows, hiddenColumns: sheet.hiddenColumns })))).digest("hex");
  return { version: EXCEL_MAPPING_VERSION, fingerprint, sheets, observations: [
    ...excludedSheets, ...sheets.flatMap(sheet => sheet.observations.map(note => `${sheet.name}: ${note}`))] };
}
