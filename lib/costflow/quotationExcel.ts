import "server-only";

import ExcelJS from "exceljs";
import { EXCEL_INTAKE_SCHEMA_VERSION } from "./excelIntake";
import type { RoundTripProjection } from "./excelRoundTrip";

const SELL_FILL = "FFC6E0B4";
const BUY_FILL = "FFFFD966";
const HEADER_FILL = "FF1F4E78";
const BORDER_COLOR = "FFB7C3D0";
const FIRST_DATA_ROW = 7;
const LAST_DATA_ROW = 206;

export type ExcelIntakeTemplateOptions = {
  projectName?: string;
  customer?: string;
  generatedAt?: string;
  location?: string;
};

const headers = [
  "CẤP", "STT", "HẠNG MỤC", "MÔ TẢ",
  "ĐVT", "SỐ LƯỢNG", "SỐ NGÀY", "ĐƠN GIÁ", "CƠ SỞ", "VAT %", "NET", "VAT", "GROSS", "GHI CHÚ KHÁCH",
  "ĐVT MUA", "SL MUA", "SỐ NGÀY MUA", "GIÁ VỐN", "CƠ SỞ MUA", "VAT MUA %", "NET IC", "VAT IC", "GROSS IC", "NHÀ CUNG CẤP", "GHI CHÚ NỘI BỘ",
] as const;

function styleHeader(cell: ExcelJS.Cell, fill: string) {
  cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF1F2937" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = { top: { style: "thin", color: { argb: BORDER_COLOR } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } }, left: { style: "thin", color: { argb: BORDER_COLOR } }, right: { style: "thin", color: { argb: BORDER_COLOR } } };
}

function formula(row: number, scope: "sell" | "buy", kind: "net" | "vat" | "gross") {
  const quantity = scope === "sell" ? `F${row}` : `P${row}`;
  const days = scope === "sell" ? `G${row}` : `Q${row}`;
  const price = scope === "sell" ? `H${row}` : `R${row}`;
  const basis = scope === "sell" ? `I${row}` : `S${row}`;
  const vat = scope === "sell" ? `J${row}` : `T${row}`;
  const blank = `OR(${quantity}="",${days}="",${price}="",${basis}="",${vat}="")`;
  const net = `IF(${basis}="NET",${quantity}*${days}*${price},${quantity}*${days}*${price}/(1+${vat}/100))`;
  if (kind === "net") return `IF(${blank},"",${net})`;
  if (kind === "vat") return `IF(${blank},"",(${net})*${vat}/100)`;
  return `IF(${blank},"",(${net})*(1+${vat}/100))`;
}

function addValidations(sheet: ExcelJS.Worksheet, row: number) {
  for (const column of [6, 7, 8, 10, 16, 17, 18, 20]) {
    sheet.getCell(row, column).dataValidation = { type: "decimal", operator: "greaterThan", allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: "Giá trị không hợp lệ", error: "Nhập số lớn hơn 0; dùng số 0 cho đơn giá FOC và thêm ghi chú." };
  }
  for (const column of [9, 19]) sheet.getCell(row, column).dataValidation = { type: "list", allowBlank: true, formulae: ['"NET,GROSS"'], showErrorMessage: true, errorTitle: "Cơ sở không hợp lệ", error: "Chọn NET hoặc GROSS." };
}

function addPreviewFormulas(sheet: ExcelJS.Worksheet, row: number) {
  sheet.getCell(`K${row}`).value = { formula: formula(row, "sell", "net") };
  sheet.getCell(`L${row}`).value = { formula: formula(row, "sell", "vat") };
  sheet.getCell(`M${row}`).value = { formula: formula(row, "sell", "gross") };
  sheet.getCell(`U${row}`).value = { formula: formula(row, "buy", "net") };
  sheet.getCell(`V${row}`).value = { formula: formula(row, "buy", "vat") };
  sheet.getCell(`W${row}`).value = { formula: formula(row, "buy", "gross") };
}

export async function createExcelIntakeTemplate(options: ExcelIntakeTemplateOptions = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TaskFlow CostFlow";
  workbook.created = new Date(options.generatedAt ?? Date.now());
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet("BAO_GIA_IC", {
    views: [{ state: "frozen", xSplit: 4, ySplit: 6, topLeftCell: "E7", activeCell: "D8" }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToWidth: 1, fitToHeight: 0, printArea: "A1:Y40" },
    properties: { defaultRowHeight: 22 },
  });
  sheet.mergeCells("B1:Y1");
  sheet.getCell("B1").value = "EXCEL INTAKE v4 · BÁO GIÁ & IC";
  sheet.getCell("B1").font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getCell("B1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  sheet.getCell("B1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 30;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  [["B2", "PROJECT"], ["B3", "KHÁCH HÀNG"], ["H2", "THỜI GIAN"], ["H3", "ĐỊA ĐIỂM"]].forEach(([ref, value]) => { sheet.getCell(ref).value = value; sheet.getCell(ref).font = { name: "Arial", size: 9, bold: true }; });
  sheet.getCell("C2").value = options.projectName ?? "";
  sheet.getCell("C3").value = options.customer ?? "";
  sheet.getCell("I2").value = generatedAt;
  sheet.getCell("I3").value = options.location ?? "";
  sheet.mergeCells("C2:F2"); sheet.mergeCells("C3:F3"); sheet.mergeCells("I2:M2"); sheet.mergeCells("I3:M3");
  sheet.mergeCells("E5:N5"); sheet.getCell("E5").value = "BÁO GIÁ KHÁCH"; styleHeader(sheet.getCell("E5"), SELL_FILL);
  sheet.mergeCells("O5:Y5"); sheet.getCell("O5").value = "IC NỘI BỘ"; styleHeader(sheet.getCell("O5"), BUY_FILL);
  headers.forEach((value, index) => { const cell = sheet.getCell(6, index + 1); cell.value = value; styleHeader(cell, index >= 14 ? BUY_FILL : index >= 4 ? SELL_FILL : "FFD9EAF7"); });
  sheet.getRow(6).height = 38;
  [7, 8, 9, 10].forEach(row => { addValidations(sheet, row); addPreviewFormulas(sheet, row); });
  sheet.getRow(7).values = [1, "", "A. NHÓM CHƯƠNG TRÌNH", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
  sheet.getRow(8).values = [2, "1", "Điều phối", "Nhân sự điều phối chương trình", "người", 2, 1.5, 1500000, "NET", 8, { formula: formula(8, "sell", "net") }, { formula: formula(8, "sell", "vat") }, { formula: formula(8, "sell", "gross") }, "", "người", "", "", "", "NET", 8, { formula: formula(8, "buy", "net") }, { formula: formula(8, "buy", "vat") }, { formula: formula(8, "buy", "gross") }, "", ""];
  sheet.getRow(9).values = [3, "", "", "Ca chiều", "ca", 1, 0.5, 500000, "NET", 8, { formula: formula(9, "sell", "net") }, { formula: formula(9, "sell", "vat") }, { formula: formula(9, "sell", "gross") }, "", "ca", "", "", "", "NET", 8, { formula: formula(9, "buy", "net") }, { formula: formula(9, "buy", "vat") }, { formula: formula(9, "buy", "gross") }, "", ""];
  sheet.getRow(10).values = [2, "2", "Quà tặng FOC", "Hạng mục tặng khách", "gói", 1, 1, 0, "NET", 0, { formula: formula(10, "sell", "net") }, { formula: formula(10, "sell", "vat") }, { formula: formula(10, "sell", "gross") }, "FOC theo thỏa thuận", "gói", "", "", "", "NET", 0, { formula: formula(10, "buy", "net") }, { formula: formula(10, "buy", "vat") }, { formula: formula(10, "buy", "gross") }, "", ""];
  for (let row = FIRST_DATA_ROW; row <= LAST_DATA_ROW; row++) {
    if (row > 10) { addValidations(sheet, row); addPreviewFormulas(sheet, row); }
    for (let column = 1; column <= headers.length; column++) {
      const cell = sheet.getCell(row, column);
      cell.font = { name: "Arial", size: 9, bold: row === 7 };
      cell.alignment = { vertical: "middle", wrapText: true, horizontal: [1, 2, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20].includes(column) ? "center" : undefined };
      cell.border = { bottom: { style: "hair", color: { argb: BORDER_COLOR } }, right: { style: "hair", color: { argb: BORDER_COLOR } } };
      if (row === 7) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2F0D9" } };
      if ([8, 10, 11, 12, 13, 21, 22, 23].includes(column)) cell.numFmt = "#,##0.00";
    }
  }
  const widths = [7, 8, 24, 34, 10, 12, 11, 15, 10, 10, 15, 15, 15, 24, 12, 12, 13, 15, 13, 12, 15, 15, 15, 24, 28];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.autoFilter = { from: "A6", to: "Y206" };
  sheet.headerFooter.oddFooter = "Excel Intake v4 · Preview only · TaskFlow tính lại trên máy chủ";

  const projection = workbook.addWorksheet("_IMPORT", { state: "veryHidden" });
  projection.addRow(["candidateKey", "parentCandidateKey", "order", "level", "rowType", "sourceRow", "sell.quantity", "sell.days", "sell.unitPrice", "sell.basis", "sell.vatPercent", "buy.quantity", "buy.days", "buy.unitPrice", "buy.basis", "buy.vatPercent"]);
  projection.addRow(["candidate-1", "", 0, 1, "GROUP", 7]);
  projection.addRow(["candidate-2", "candidate-1", 1, 2, "ITEM", 8]);
  projection.addRow(["candidate-3", "candidate-2", 2, 3, "ITEM", 9]);
  projection.addRow(["candidate-4", "candidate-1", 3, 2, "ITEM", 10]);
  projection.getRow(1).font = { bold: true };

  const metadata = workbook.addWorksheet("_META", { state: "veryHidden" });
  metadata.addRows([
    ["schemaVersion", EXCEL_INTAKE_SCHEMA_VERSION],
    ["visibleSheet", "BAO_GIA_IC"],
    ["inputRange", `A${FIRST_DATA_ROW}:Y${LAST_DATA_ROW}`],
    ["authority", "Preview formulas only; server calculations from normalized primitive inputs are authoritative."],
    ["generatedAt", generatedAt],
    ["privacy", "No evidence bytes, credentials, approval, budget, cash, signing, execution, revenue or settlement state."],
    ["futureImport", "Plan 10 must preflight file signature, size, compression ratio and macros before parsing."],
  ]);
  metadata.getColumn(1).width = 24; metadata.getColumn(2).width = 110;
  return workbook.xlsx.writeBuffer();
}

function excelPrimitive(value: string) {
  if (!value) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

export async function createExcelRoundTripWorkbook(projection: RoundTripProjection, options: ExcelIntakeTemplateOptions = {}) {
  if (projection.rows.length > LAST_DATA_ROW - FIRST_DATA_ROW + 1) throw new Error("Nháp vượt quá giới hạn 200 dòng của workbook.");
  const template = await createExcelIntakeTemplate({ ...options, customer: projection.customer });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template);
  const sheet = workbook.getWorksheet("BAO_GIA_IC")!;
  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= LAST_DATA_ROW; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    for (const column of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16, 17, 18, 19, 20, 24, 25]) row.getCell(column).value = "";
  }
  projection.rows.forEach((entry, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    const row = entry.row;
    const values: unknown[] = [
      entry.level, index + 1, row.name, row.description,
      row.sell.unit, excelPrimitive(row.sell.quantity), excelPrimitive(row.sell.days), excelPrimitive(row.sell.unitPrice), row.sell.basis, excelPrimitive(row.sell.vatPercent),
      undefined, undefined, undefined, row.sell.notes,
      row.buy.unit, excelPrimitive(row.buy.quantity), excelPrimitive(row.buy.days), excelPrimitive(row.buy.unitPrice), row.buy.basis, excelPrimitive(row.buy.vatPercent),
      undefined, undefined, undefined, row.buy.vendorId, row.buy.notes,
    ];
    values.forEach((value, column) => {
      if (value !== undefined) sheet.getCell(rowNumber, column + 1).value = value as ExcelJS.CellValue;
    });
    sheet.getCell(rowNumber, 26).value = entry.itemId;
    sheet.getCell(rowNumber, 27).value = entry.parentItemId ?? "";
    sheet.getCell(rowNumber, 28).value = entry.order;
    addPreviewFormulas(sheet, rowNumber);
  });
  for (const column of [26, 27, 28]) sheet.getColumn(column).hidden = true;
  sheet.getCell("C2").value = options.projectName ?? "";
  sheet.getCell("C3").value = projection.customer;

  const stable = workbook.getWorksheet("_IMPORT")!;
  for (let row = 1; row <= Math.max(stable.rowCount, projection.rows.length + 1); row++) stable.getRow(row).values = [];
  stable.getRow(1).values = ["itemId", "parentItemId", "order", "level", "rowType", "sourceRow"];
  projection.rows.forEach((entry, index) => { stable.getRow(index + 2).values = [entry.itemId, entry.parentItemId ?? "", entry.order, entry.level, entry.row.rowType, FIRST_DATA_ROW + index]; });
  stable.getRow(1).font = { bold: true };

  const metadata = workbook.getWorksheet("_META")!;
  metadata.addRows([
    ["projectId", projection.projectId],
    ["draftId", projection.draftId],
    ["draftVersion", projection.draftVersion],
    ["draftFingerprint", projection.fingerprint],
    ["roundTripSchemaVersion", projection.schemaVersion],
    ["roundTripPrivacy", "Internal authenticated editable draft only; no evidence bytes or lifecycle/money state."],
  ]);
  return workbook.xlsx.writeBuffer();
}
