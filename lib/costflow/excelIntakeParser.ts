import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { EXCEL_INTAKE_SCHEMA_VERSION, normalizeExcelIntake, type ExcelIntakeInput, type ExcelIntakePrimitiveCell, type ExcelIntakeRowInput, type NormalizedExcelIntake } from "./excelIntake";
import { EXCEL_INTAKE_LIMITS, preflightExcelWorkbook } from "./excelIntakeSecurity";

export type ExcelIntakeMapping = { sheet?: string; range?: string; headerRow?: number };
export type ExcelIntakePreview = NormalizedExcelIntake & { fingerprint: string; adapter: "PASTE" | "STANDARD_V4" | "FAMILIAR_THREE_LEVEL"; confidence: number };

const canonicalHeaders = ["LEVEL", "ROW_TYPE", "PARENT_ROW", "NAME", "DESCRIPTION", "SELL_UNIT", "SELL_QUANTITY", "SELL_DAYS", "SELL_UNIT_PRICE", "SELL_VAT", "SELL_BASIS", "SELL_NOTE", "BUY_UNIT", "BUY_QUANTITY", "BUY_DAYS", "BUY_UNIT_PRICE", "BUY_VAT", "BUY_BASIS", "SUPPLIER", "BUY_NOTE"];
const aliases: Record<string, string> = {
  "STT": "ORDER",
  "CẤP": "LEVEL", "LOẠI DÒNG": "ROW_TYPE", "DÒNG CHA": "PARENT_ROW", "HẠNG MỤC": "NAME", "MÔ TẢ": "DESCRIPTION",
  "ĐVT": "SELL_UNIT", "SỐ LƯỢNG": "SELL_QUANTITY", "SỐ NGÀY": "SELL_DAYS", "ĐƠN GIÁ": "SELL_UNIT_PRICE", "VAT %": "SELL_VAT", "CƠ SỞ": "SELL_BASIS", "GHI CHÚ KHÁCH": "SELL_NOTE",
  "ĐVT MUA": "BUY_UNIT", "SL MUA": "BUY_QUANTITY", "SỐ NGÀY MUA": "BUY_DAYS", "GIÁ VỐN": "BUY_UNIT_PRICE", "VAT MUA %": "BUY_VAT", "CƠ SỞ MUA": "BUY_BASIS", "NHÀ CUNG CẤP": "SUPPLIER", "GHI CHÚ NỘI BỘ": "BUY_NOTE",
};

type PreviewField = "previewNet" | "previewVat" | "previewGross" | "previewBuyNet" | "previewBuyVat" | "previewBuyGross";

const previewHeaders: ReadonlyMap<string, PreviewField> = new Map([
  ["NET", "previewNet"],
  ["VAT", "previewVat"],
  ["GROSS", "previewGross"],
  ["NET IC", "previewBuyNet"],
  ["VAT IC", "previewBuyVat"],
  ["GROSS IC", "previewBuyGross"],
] as const);

type FormulaMatrixCell = { kind: "FORMULA"; formula: string; cachedValue: unknown };

function isFormulaMatrixCell(value: unknown): value is FormulaMatrixCell {
  return !!value && typeof value === "object" && (value as { kind?: unknown }).kind === "FORMULA";
}

function matrixValue(value: unknown) {
  return isFormulaMatrixCell(value) ? value.cachedValue ?? "" : value;
}

function normalizedHeader(value: unknown) {
  return String(matrixValue(value) ?? "").trim().toUpperCase();
}

function columnName(column: number) { let value = column; let name = ""; while (value) { value--; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); } return name; }
function primitive(value: unknown, sheet: string, row: number, column: number): ExcelIntakePrimitiveCell {
  const source = { sheet, row, column, cell: `${columnName(column)}${row}` };
  if (isFormulaMatrixCell(value)) return { value: value.cachedValue ?? "", source, observation: { formula: value.formula, cachedValue: value.cachedValue } };
  return { value, source };
}
function buildInput(matrix: unknown[][], sheet: string, startRow: number, kind: "PASTE" | "XLSX", range: string): ExcelIntakeInput {
  if (matrix.length === 0) throw new Error("Vùng dữ liệu cần hàng tiêu đề và ít nhất một dòng.");
  if (matrix.length - 1 > EXCEL_INTAKE_LIMITS.rows || Math.max(...matrix.map(row => row.length)) > EXCEL_INTAKE_LIMITS.columns) throw new Error("Vùng dữ liệu vượt giới hạn 500 dòng x 40 cột.");
  const rawHeaders = matrix[0].map(normalizedHeader);
  const headers = rawHeaders.map(value => aliases[value] ?? value);
  const index = canonicalHeaders.map(header => headers.indexOf(header));
  const previewIndex = new Map<string, number>();
  rawHeaders.forEach((header, column) => {
    const field = previewHeaders.get(header);
    if (field) previewIndex.set(field, column);
  });
  const previewColumns = new Set(previewIndex.values());
  matrix.forEach((values, rowOffset) => values.forEach((value, column) => {
    if (!isFormulaMatrixCell(value)) return;
    if (rowOffset === 0 || !previewColumns.has(column)) {
      throw new Error(`Ô ${columnName(column + 1)}${startRow + rowOffset} chứa công thức ở trường dữ liệu; máy chủ chỉ nhận giá trị nguyên thủy.`);
    }
  }));
  if (matrix.length < 2) throw new Error("Vùng dữ liệu cần hàng tiêu đề và ít nhất một dòng.");
  const hasExplicitStructure = index[canonicalHeaders.indexOf("ROW_TYPE")] >= 0 && index[canonicalHeaders.indexOf("PARENT_ROW")] >= 0;
  if (["LEVEL", "NAME", "DESCRIPTION"].some(header => index[canonicalHeaders.indexOf(header)] < 0)) throw new Error("Không nhận diện được cấu trúc cột. Hãy ánh xạ sheet/range/tiêu đề.");
  const levelColumn = index[canonicalHeaders.indexOf("LEVEL")];
  const orderColumn = headers.indexOf("ORDER");
  const cell = (values: unknown[], key: string, row: number) => {
    const column = index[canonicalHeaders.indexOf(key)];
    return primitive(column < 0 ? "" : values[column], sheet, row, (column < 0 ? levelColumn : column) + 1);
  };
  const identityColumns = ["LEVEL", "ROW_TYPE", "PARENT_ROW", "NAME", "DESCRIPTION"]
    .map(header => index[canonicalHeaders.indexOf(header)])
    .filter(column => column >= 0);
  if (orderColumn >= 0) identityColumns.push(orderColumn);
  const sourceRows = matrix.slice(1).map((values, offset) => ({ values, row: startRow + offset + 1 }))
    .filter(({ values }) => identityColumns.some(column => String(matrixValue(values[column]) ?? "").trim()));
  const previousSourceRowByLevel = new Map<number, number>();
  const rows: ExcelIntakeRowInput[] = sourceRows.map(({ values, row }) => {
    const value = (key: string) => cell(values, key, row);
    const explicitLevel = Number(String(matrixValue(values[levelColumn]) ?? "").trim());
    const order = orderColumn < 0 ? "" : String(matrixValue(values[orderColumn]) ?? "").trim();
    const level = [1, 2, 3].includes(explicitLevel)
      ? explicitLevel
      : previousSourceRowByLevel.has(1)
        ? order ? 2 : previousSourceRowByLevel.has(2) ? 3 : 2
        : 1;
    const sideFields = ["SELL_UNIT", "SELL_QUANTITY", "SELL_DAYS", "SELL_UNIT_PRICE", "SELL_VAT", "SELL_BASIS", "BUY_UNIT", "BUY_QUANTITY", "BUY_DAYS", "BUY_UNIT_PRICE", "BUY_VAT", "BUY_BASIS"];
    const hasSideInput = sideFields.some(key => {
      const column = index[canonicalHeaders.indexOf(key)];
      return column >= 0 && String(matrixValue(values[column]) ?? "").trim();
    });
    const derivedRowType = level === 1 && !hasSideInput ? "GROUP" : "ITEM";
    const derivedParentRow = level > 1 ? previousSourceRowByLevel.get(level - 1) ?? "" : "";
    if (Number.isInteger(level) && level > 0) {
      previousSourceRowByLevel.set(level, row);
      for (const knownLevel of [...previousSourceRowByLevel.keys()]) if (knownLevel > level) previousSourceRowByLevel.delete(knownLevel);
    }
    const preview = (field: PreviewField) => {
      const column = previewIndex.get(field);
      return column === undefined ? undefined : primitive(values[column], sheet, row, column + 1);
    };
    return { level: [1, 2, 3].includes(explicitLevel) ? value("LEVEL") : primitive(level, sheet, row, levelColumn + 1), rowType: hasExplicitStructure ? value("ROW_TYPE") : primitive(derivedRowType, sheet, row, levelColumn + 1), parentRow: hasExplicitStructure ? value("PARENT_ROW") : primitive(derivedParentRow, sheet, row, levelColumn + 1), name: value("NAME"), description: value("DESCRIPTION"),
      sell: { unit: value("SELL_UNIT"), quantity: value("SELL_QUANTITY"), days: value("SELL_DAYS"), unitPrice: value("SELL_UNIT_PRICE"), vatPercent: value("SELL_VAT"), basis: value("SELL_BASIS"), note: value("SELL_NOTE") },
      buy: { unit: value("BUY_UNIT"), quantity: value("BUY_QUANTITY"), days: value("BUY_DAYS"), unitPrice: value("BUY_UNIT_PRICE"), vatPercent: value("BUY_VAT"), basis: value("BUY_BASIS"), supplier: value("SUPPLIER"), note: value("BUY_NOTE") },
      previewNet: preview("previewNet"), previewVat: preview("previewVat"), previewGross: preview("previewGross"), previewBuyNet: preview("previewBuyNet"), previewBuyVat: preview("previewBuyVat"), previewBuyGross: preview("previewBuyGross") };
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
  const dimensions = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(String(selected.dimensions));
  if (!dimensions) throw new Error("Vùng dữ liệu XLSX không hợp lệ.");
  let detectedHeaderRow: number | undefined;
  if (!mapping.range && mapping.headerRow === undefined) {
    const firstRow = Number(dimensions[2]);
    const lastCandidateRow = Math.min(Number(dimensions[4]), firstRow + 50);
    for (let row = firstRow; row <= lastCandidateRow; row++) {
      const values = selected.getRow(row).values;
      const headers = Array.isArray(values) ? values.map(normalizedHeader) : [];
      const normalized = headers.map(value => aliases[value] ?? value);
      if (normalized.includes("LEVEL") && normalized.includes("NAME") && normalized.includes("DESCRIPTION")) { detectedHeaderRow = row; break; }
    }
  }
  const range = mapping.range ?? `${dimensions[1]}${mapping.headerRow ?? detectedHeaderRow ?? dimensions[2]}:${dimensions[3]}${dimensions[4]}`;
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
      if (cell.type === ExcelJS.ValueType.Formula) {
        const formulaValue = cell.value as ExcelJS.CellFormulaValue;
        values.push({ kind: "FORMULA", formula: cell.formula ?? "", cachedValue: formulaValue.result } satisfies FormulaMatrixCell);
      } else values.push(cell.value ?? "");
    }
    matrix.push(values);
  }
  const marker = `${String(selected.getCell("A1").value ?? "")} ${String(selected.getCell("B1").value ?? "")}`;
  return finish(buildInput(matrix, selected.name, startRow, "XLSX", range), marker.includes("v4") ? "STANDARD_V4" : "FAMILIAR_THREE_LEVEL", marker.includes("v4") ? 1 : 0.75);
}
