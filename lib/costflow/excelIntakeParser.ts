import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { EXCEL_INTAKE_SCHEMA_VERSION, normalizeExcelIntake, type ExcelIntakeInput, type ExcelIntakePrimitiveCell, type ExcelIntakeRowInput, type NormalizedExcelIntake } from "./excelIntake";
import { EXCEL_INTAKE_LIMITS, preflightExcelWorkbook } from "./excelIntakeSecurity";

export type ExcelIntakeMapping = { sheet?: string; range?: string; headerRow?: number };
export type ExcelIntakePreview = NormalizedExcelIntake & { fingerprint: string; adapter: "PASTE" | "STANDARD_V4" | "FAMILIAR_THREE_LEVEL"; confidence: number };

const canonicalHeaders = ["LEVEL", "ROW_TYPE", "PARENT_ROW", "NAME", "DESCRIPTION", "SELL_UNIT", "SELL_QUANTITY", "SELL_DAYS", "SELL_UNIT_PRICE", "SELL_VAT", "SELL_BASIS", "SELL_NOTE", "BUY_UNIT", "BUY_QUANTITY", "BUY_DAYS", "BUY_UNIT_PRICE", "BUY_VAT", "BUY_BASIS", "SUPPLIER", "BUY_NOTE"];
const aliases: Record<string, string> = {
  "CẤP": "LEVEL", "LOẠI DÒNG": "ROW_TYPE", "DÒNG CHA": "PARENT_ROW", "HẠNG MỤC": "NAME", "MÔ TẢ": "DESCRIPTION",
  "ĐVT": "SELL_UNIT", "SỐ LƯỢNG": "SELL_QUANTITY", "SỐ NGÀY": "SELL_DAYS", "ĐƠN GIÁ": "SELL_UNIT_PRICE", "VAT %": "SELL_VAT", "CƠ SỞ": "SELL_BASIS", "GHI CHÚ KHÁCH": "SELL_NOTE",
  "ĐVT MUA": "BUY_UNIT", "SL MUA": "BUY_QUANTITY", "SỐ NGÀY MUA": "BUY_DAYS", "GIÁ VỐN": "BUY_UNIT_PRICE", "VAT MUA %": "BUY_VAT", "CƠ SỞ MUA": "BUY_BASIS", "NHÀ CUNG CẤP": "SUPPLIER", "GHI CHÚ NỘI BỘ": "BUY_NOTE",
};

function columnName(column: number) { let value = column; let name = ""; while (value) { value--; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); } return name; }
function primitive(value: unknown, sheet: string, row: number, column: number): ExcelIntakePrimitiveCell {
  return { value, source: { sheet, row, column, cell: `${columnName(column)}${row}` } };
}
function buildInput(matrix: unknown[][], sheet: string, startRow: number, kind: "PASTE" | "XLSX", range: string): ExcelIntakeInput {
  if (matrix.length < 2) throw new Error("Vùng dữ liệu cần hàng tiêu đề và ít nhất một dòng.");
  if (matrix.length - 1 > EXCEL_INTAKE_LIMITS.rows || Math.max(...matrix.map(row => row.length)) > EXCEL_INTAKE_LIMITS.columns) throw new Error("Vùng dữ liệu vượt giới hạn 500 dòng x 40 cột.");
  const headers = matrix[0].map(value => aliases[String(value ?? "").trim().toUpperCase()] ?? String(value ?? "").trim().toUpperCase());
  const index = canonicalHeaders.map(header => headers.indexOf(header));
  if (index.slice(0, 5).some(value => value < 0)) throw new Error("Không nhận diện được cấu trúc cột. Hãy ánh xạ sheet/range/tiêu đề.");
  const cell = (values: unknown[], key: string, row: number) => {
    const column = index[canonicalHeaders.indexOf(key)];
    return primitive(column < 0 ? "" : values[column], sheet, row, Math.max(0, column) + 1);
  };
  const rows: ExcelIntakeRowInput[] = matrix.slice(1).filter(values => values.some(value => String(value ?? "").trim())).map((values, offset) => {
    const row = startRow + offset + 1;
    const value = (key: string) => cell(values, key, row);
    return { level: value("LEVEL"), rowType: value("ROW_TYPE"), parentRow: value("PARENT_ROW"), name: value("NAME"), description: value("DESCRIPTION"),
      sell: { unit: value("SELL_UNIT"), quantity: value("SELL_QUANTITY"), days: value("SELL_DAYS"), unitPrice: value("SELL_UNIT_PRICE"), vatPercent: value("SELL_VAT"), basis: value("SELL_BASIS"), note: value("SELL_NOTE") },
      buy: { unit: value("BUY_UNIT"), quantity: value("BUY_QUANTITY"), days: value("BUY_DAYS"), unitPrice: value("BUY_UNIT_PRICE"), vatPercent: value("BUY_VAT"), basis: value("BUY_BASIS"), supplier: value("SUPPLIER"), note: value("BUY_NOTE") } };
  });
  return { schemaVersion: EXCEL_INTAKE_SCHEMA_VERSION, source: { kind, sheet, range }, metadata: { projectName: "", customer: "", preparedAt: "", location: "" }, rows };
}
function finish(input: ExcelIntakeInput, adapter: ExcelIntakePreview["adapter"], confidence: number): ExcelIntakePreview {
  const normalized = normalizeExcelIntake(input);
  const fingerprint = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return { ...normalized, fingerprint, adapter, confidence };
}
export function previewPastedIntake(input: { text: string; sheet?: string }): ExcelIntakePreview {
  if (input.text.length > EXCEL_INTAKE_LIMITS.textLength) throw new Error("Dữ liệu dán vượt giới hạn.");
  const delimiter = input.text.includes("\t") ? "\t" : ",";
  const matrix = input.text.replace(/\r/g, "").split("\n").map(line => line.split(delimiter));
  const sheet = input.sheet || "DAN_BANG";
  return finish(buildInput(matrix, sheet, 1, "PASTE", `A1:${columnName(Math.max(...matrix.map(row => row.length)))}${matrix.length}`), "PASTE", 1);
}
export async function previewWorkbookIntake(bytes: Uint8Array, mapping: ExcelIntakeMapping = {}, mimeType?: string): Promise<ExcelIntakePreview> {
  await preflightExcelWorkbook(bytes, mimeType);
  const workbook = new ExcelJS.Workbook();
  const workbookBytes = Buffer.from(bytes);
  await workbook.xlsx.load(workbookBytes.buffer.slice(workbookBytes.byteOffset, workbookBytes.byteOffset + workbookBytes.byteLength) as ArrayBuffer);
  if (workbook.worksheets.length > EXCEL_INTAKE_LIMITS.sheets) throw new Error("Tệp XLSX có quá nhiều sheet.");
  const selected = mapping.sheet ? workbook.getWorksheet(mapping.sheet) : workbook.worksheets.find(sheet => !/nhà cung cấp|supplier|evidence|chứng từ/i.test(sheet.name));
  if (!selected || /nhà cung cấp|supplier|evidence|chứng từ/i.test(selected.name)) throw new Error("Sheet NCC/chứng từ chỉ dùng tham khảo, không tự nhập dòng chi phí.");
  const range = mapping.range ?? String(selected.dimensions);
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(range);
  if (!match) throw new Error("Vùng dữ liệu XLSX không hợp lệ.");
  const startRow = mapping.headerRow ?? Number(match[2]);
  const endRow = Number(match[4]);
  const startColumn = selected.getColumn(match[1]!).number;
  const endColumn = selected.getColumn(match[3]!).number;
  if (endRow - startRow > EXCEL_INTAKE_LIMITS.rows || endColumn - startColumn + 1 > EXCEL_INTAKE_LIMITS.columns) throw new Error("Vùng dữ liệu vượt giới hạn 500 dòng x 40 cột.");
  const matrix: unknown[][] = [];
  for (let row = startRow; row <= endRow; row++) {
    const values: unknown[] = [];
    for (let column = startColumn; column <= endColumn; column++) {
      const cell = selected.getCell(row, column);
      if (cell.type === ExcelJS.ValueType.Formula) throw new Error(`Ô ${cell.address} chứa công thức; chỉ nhập dữ liệu nguyên thủy.`);
      values.push(cell.value ?? "");
    }
    matrix.push(values);
  }
  const marker = String(selected.getCell("A1").value ?? "");
  return finish(buildInput(matrix, selected.name, startRow, "XLSX", range), marker.includes("v4") ? "STANDARD_V4" : "FAMILIAR_THREE_LEVEL", marker.includes("v4") ? 1 : 0.75);
}
