import ExcelJS from "exceljs";
import { moneyInWords } from "./money";
import type { RequestPayload } from "./types";

export const SETTLEMENT_EXPORT_FAMILIES = [
  "QUOTATION",
  "CUSTOMER_ACCEPTANCE",
  "DNTU",
  "DNTT",
  "DNHTU",
  "PROJECT_SETTLEMENT",
] as const;

export type SettlementExportFamily = typeof SETTLEMENT_EXPORT_FAMILIES[number];
export type SettlementExportSource = {
  dossierId: string;
  dossierVersionId: string;
  dossierVersion: number;
  documentVersionId: string;
  documentVersion: number;
  state: string;
  supersedesId?: string | null;
  replacedById?: string | null;
  replacementReason?: string | null;
};
export type SettlementExportProjection = {
  projectId: string;
  projectName?: string;
  family: SettlementExportFamily;
  source: SettlementExportSource;
  title?: string;
  approvedAt?: string;
  totals: {
    rawNet: string;
    rawVat: string;
    rawGross: string;
    net: string;
    vat: string;
    gross: string;
  };
  recipients: Array<{
    recipientKey: string;
    recipientType: string;
    displayName: string;
    actualGross: string;
    advanceGross: string;
    refundDue: string;
    additionalDue: string;
  }>;
  items: Array<{
    stableLineId: string;
    description: string;
    recipientKey: string;
    rawNet: string;
    rawVat: string;
    rawGross: string;
    net: string;
    vat: string;
    gross: string;
  }>;
  obligations: Array<{ recipientKey: string; direction: string; amountDue: string }>;
  evidence: Array<{ id: string; kind: string; sha256: string }>;
  signingSnapshot: {
    id: string;
    state: string;
    projectionSha256: string;
    events: Array<{ role: string; actorId: string; eventHash: string; signedAt: string }>;
  };
};

type NormalizedSettlementExportProjection = SettlementExportProjection & {
  approvedGross: string;
  moneyInWords: string;
};

const INTEGER_VND = /^-?(?:0|[1-9]\d*)$/;

function requiredText(value: string, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Thiếu ${label} của phiên bản xuất.`);
  return text;
}

function integerVnd(value: string, label: string) {
  const text = requiredText(value, label);
  if (!INTEGER_VND.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new Error(`${label} phải là số nguyên VND an toàn.`);
  }
  return text;
}

export function normalizeSettlementExportProjection(input: SettlementExportProjection): NormalizedSettlementExportProjection {
  if (!SETTLEMENT_EXPORT_FAMILIES.includes(input.family)) throw new Error("Loại chứng từ xuất không hợp lệ.");
  requiredText(input.projectId, "Project");
  requiredText(input.source.dossierVersionId, "dossier version ID");
  requiredText(input.source.documentVersionId, "document version ID");
  if (!Number.isSafeInteger(input.source.dossierVersion) || input.source.dossierVersion < 1) throw new Error("Phiên bản dossier không hợp lệ.");
  if (!Number.isSafeInteger(input.source.documentVersion) || input.source.documentVersion < 1) throw new Error("Phiên bản tài liệu không hợp lệ.");
  if (input.source.state !== "APPROVED") throw new Error("Chỉ xuất từ phiên bản đã duyệt và bất biến.");
  const net = integerVnd(input.totals.net, "Net");
  const vat = integerVnd(input.totals.vat, "VAT");
  const gross = integerVnd(input.totals.gross, "Gross");
  if (BigInt(net) + BigInt(vat) !== BigInt(gross)) throw new Error("Bản chiếu xuất phải giữ Net + VAT = Gross.");
  for (const row of input.recipients) {
    integerVnd(row.actualGross, "AC người nhận");
    integerVnd(row.advanceGross, "tạm ứng người nhận");
    integerVnd(row.refundDue, "hoàn lại");
    integerVnd(row.additionalDue, "chi thêm");
  }
  for (const row of input.items) {
    const rowNet = integerVnd(row.net, "Net dòng AC");
    const rowVat = integerVnd(row.vat, "VAT dòng AC");
    const rowGross = integerVnd(row.gross, "Gross dòng AC");
    if (BigInt(rowNet) + BigInt(rowVat) !== BigInt(rowGross)) throw new Error("Dòng AC phải giữ Net + VAT = Gross.");
  }
  return { ...input, totals: { ...input.totals, net, vat, gross }, approvedGross: gross, moneyInWords: moneyInWords(gross) };
}

function titleFor(family: SettlementExportFamily) {
  return {
    QUOTATION: "BÁO GIÁ",
    CUSTOMER_ACCEPTANCE: "NGHIỆM THU KHÁCH HÀNG",
    DNTU: "PHIẾU ĐỀ NGHỊ TẠM ỨNG",
    DNTT: "PHIẾU ĐỀ NGHỊ THANH TOÁN",
    DNHTU: "PHIẾU ĐỀ NGHỊ HOÀN TẠM ỨNG",
    PROJECT_SETTLEMENT: "QUYẾT TOÁN DỰ ÁN",
  }[family];
}

function setText(cell: ExcelJS.Cell, value: unknown) {
  cell.value = String(value ?? "");
}

function setMoney(cell: ExcelJS.Cell, value: string) {
  cell.value = Number(integerVnd(value, "giá trị XLSX"));
  cell.numFmt = "#,##0;[Red]-#,##0";
}

function cachedFormula(formula: string, result: number) {
  // ExcelJS drops a numeric 0 during OOXML round-trip; the string form keeps an
  // explicit cached value while remaining lossless for integer VND.
  return { formula, result: result === 0 ? "0" : result };
}

function addSourceMetadata(sheet: ExcelJS.Worksheet, projection: NormalizedSettlementExportProjection) {
  sheet.addRow(["Project", projection.projectName ?? projection.projectId]);
  sheet.addRow(["Dossier version", `${projection.source.dossierVersionId} / v${projection.source.dossierVersion}`]);
  sheet.addRow(["Document version", `${projection.source.documentVersionId} / v${projection.source.documentVersion}`]);
  sheet.addRow(["Replacement", projection.source.replacedById ? `Đã được thay bởi ${projection.source.replacedById}` : projection.source.supersedesId ? `Thay thế ${projection.source.supersedesId}` : "Bản gốc"]);
  sheet.addRow(["Signing snapshot", `${projection.signingSnapshot.id} / ${projection.signingSnapshot.state}`]);
}

function addSignatureSlots(sheet: ExcelJS.Worksheet, projection: NormalizedSettlementExportProjection) {
  sheet.addRow([]);
  const row = sheet.addRow(["NGƯỜI LẬP", "QUẢN LÝ", "KẾ TOÁN", "GIÁM ĐỐC"]);
  row.font = { bold: true };
  const events = new Map(projection.signingSnapshot.events.map(event => [event.role, event]));
  sheet.addRow(["CREATOR", "MANAGER", "ACCOUNTANT", "CEO"].map(role => events.get(role)?.eventHash ?? "Chưa ký"));
}

function addSingleFamilySheet(workbook: ExcelJS.Workbook, projection: NormalizedSettlementExportProjection) {
  const sheet = workbook.addWorksheet(titleFor(projection.family).slice(0, 31));
  const customerSafe = projection.family === "QUOTATION" || projection.family === "CUSTOMER_ACCEPTANCE";
  const heading = sheet.addRow([titleFor(projection.family)]);
  heading.font = { bold: true, size: 16 };
  if (customerSafe) {
    sheet.addRow(["Project", projection.projectName ?? ""]);
    sheet.addRow(["Phiên bản", `v${projection.source.documentVersion}`]);
    sheet.addRow(["Ngày duyệt", projection.approvedAt ?? ""]);
  } else {
    addSourceMetadata(sheet, projection);
  }
  sheet.addRow(["STT", "Nội dung", "Người nhận", "Net", "VAT", "Gross"]);
  projection.items.forEach((item, index) => {
    const row = sheet.addRow([]);
    row.getCell(1).value = index + 1;
    setText(row.getCell(2), item.description);
    setText(row.getCell(3), customerSafe ? "" : item.recipientKey);
    setMoney(row.getCell(4), item.net);
    setMoney(row.getCell(5), item.vat);
    setMoney(row.getCell(6), item.gross);
  });
  const total = sheet.addRow(["TỔNG", "", "", Number(projection.totals.net), Number(projection.totals.vat), Number(projection.totals.gross)]);
  total.font = { bold: true };
  sheet.addRow(["Bằng chữ", projection.moneyInWords]);
  if (!customerSafe) addSignatureSlots(sheet, projection);
  return sheet;
}

function addSettlementSheets(workbook: ExcelJS.Workbook, projection: NormalizedSettlementExportProjection) {
  const reconciliation = workbook.addWorksheet("Đối soát");
  reconciliation.addRow([titleFor(projection.family)]).font = { bold: true, size: 16 };
  addSourceMetadata(reconciliation, projection);
  reconciliation.addRow(["Người nhận", "AC", "Tạm ứng", "Hoàn", "Chi thêm", "Chênh lệch"]);
  const start = reconciliation.rowCount + 1;
  projection.recipients.forEach(recipient => {
    const row = reconciliation.addRow([]);
    setText(row.getCell(1), recipient.displayName || recipient.recipientKey);
    setMoney(row.getCell(2), recipient.actualGross);
    setMoney(row.getCell(3), recipient.advanceGross);
    setMoney(row.getCell(4), recipient.refundDue);
    setMoney(row.getCell(5), recipient.additionalDue);
    row.getCell(6).value = cachedFormula(`E${row.number}-D${row.number}`, Number(recipient.additionalDue) - Number(recipient.refundDue));
  });
  const end = reconciliation.rowCount;
  const total = reconciliation.addRow(["TỔNG"]);
  for (let column = 2; column <= 6; column += 1) {
    const letter = reconciliation.getColumn(column).letter;
    const result = column === 2 ? projection.recipients.reduce((sum, row) => sum + Number(row.actualGross), 0)
      : column === 3 ? projection.recipients.reduce((sum, row) => sum + Number(row.advanceGross), 0)
        : column === 4 ? projection.recipients.reduce((sum, row) => sum + Number(row.refundDue), 0)
          : column === 5 ? projection.recipients.reduce((sum, row) => sum + Number(row.additionalDue), 0)
            : projection.recipients.reduce((sum, row) => sum + Number(row.additionalDue) - Number(row.refundDue), 0);
    total.getCell(column).value = cachedFormula(`SUM(${letter}${start}:${letter}${end})`, result);
    total.getCell(column).numFmt = "#,##0;[Red]-#,##0";
  }
  total.font = { bold: true };
  reconciliation.addRow(["Bằng chữ", projection.moneyInWords]);
  addSignatureSlots(reconciliation, projection);

  const detail = workbook.addWorksheet("Chi tiết AC");
  detail.addRow(["Mã dòng", "Nội dung", "Người nhận", "Net", "VAT", "Gross", "Kiểm tra"]);
  const detailStart = 2;
  projection.items.forEach(item => {
    const row = detail.addRow([]);
    setText(row.getCell(1), item.stableLineId);
    setText(row.getCell(2), item.description);
    setText(row.getCell(3), item.recipientKey);
    setMoney(row.getCell(4), item.net);
    setMoney(row.getCell(5), item.vat);
    setMoney(row.getCell(6), item.gross);
    row.getCell(7).value = cachedFormula(`F${row.number}-E${row.number}`, Number(item.net));
  });
  const detailEnd = detail.rowCount;
  const detailTotal = detail.addRow(["TỔNG", "", ""]);
  for (let column = 4; column <= 6; column += 1) {
    const letter = detail.getColumn(column).letter;
    const result = column === 4 ? Number(projection.totals.net) : column === 5 ? Number(projection.totals.vat) : Number(projection.totals.gross);
    detailTotal.getCell(column).value = cachedFormula(`SUM(${letter}${detailStart}:${letter}${detailEnd})`, result);
    detailTotal.getCell(column).numFmt = "#,##0;[Red]-#,##0";
  }
  detailTotal.font = { bold: true };
}

export async function buildSettlementExportWorkbook(input: SettlementExportProjection) {
  const projection = normalizeSettlementExportProjection(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Creative Station TaskFlow";
  workbook.created = new Date(projection.approvedAt ?? "2000-01-01T00:00:00.000Z");
  workbook.modified = workbook.created;
  if (projection.family === "PROJECT_SETTLEMENT") addSettlementSheets(workbook, projection);
  else addSingleFamilySheet(workbook, projection);
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach(column => { column.width = 20; });
    sheet.eachRow(row => row.eachCell(cell => { cell.alignment = { vertical: "middle", wrapText: true }; }));
  }
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    family: projection.family,
    sourceVersionId: projection.source.dossierVersionId,
    documentVersionId: projection.source.documentVersionId,
    approvedGross: projection.approvedGross,
    moneyInWords: projection.moneyInWords,
    fileName: `${projection.family.toLowerCase()}-v${projection.source.dossierVersion}.xlsx`,
    bytes,
  };
}

function xml(value: string) { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Small, uncompressed OOXML archive. No executable formulas or numeric Float conversion.
function zip(files: Record<string, string>) {
  const chunks: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path), bytes = Buffer.from(content), crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, bytes);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, name); offset += header.length + name.length + bytes.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.reduce((n, b) => n + b.length, 0), 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...directory, end]);
}

export type ReimbursementExport = { id: string; title: string; project: string; requester: string; createdDate: string; approval: string; payload: RequestPayload };
export function reimbursementRows(input: ReimbursementExport): string[][] {
  const p = input.payload;
  return [
    ["CREATIVE STATION", "", "", "", "", "", "", "Mẫu: ĐNHTU-CS.2026"],
    ["PHIẾU ĐỀ NGHỊ HOÀN TẠM ỨNG"],
    ["Người xin thanh toán:", input.requester],
    ["Chương trình:", input.project],
    ["Lý do hoàn toán:", p.explanation || input.title],
    ["Mã / phiên bản nguồn:", input.id, "Trạng thái duyệt:", input.approval, "Trạng thái ký:", "Chưa ký"],
    ["STT", "Chứng từ - Số", "Ngày", "Nội dung", "Số tiền thực tế phát sinh", "Tổng số tiền đã tạm ứng", "Thanh toán bổ sung", "Thu hoàn tạm ứng", "Người nhận - STK"],
    ["1", input.id, input.createdDate, input.title, p.actualGross ?? "0", p.advance ?? "0", p.additional ?? "0", p.refund ?? "0", p.beneficiary ? `${p.beneficiary.name} - ${p.beneficiary.account}` : input.requester],
    ["Tổng cộng", "", "", "", p.actualGross ?? "0", p.advance ?? "0", p.additional ?? "0", p.refund ?? "0"],
    ["Bằng chữ:", moneyInWords(p.actualGross ?? "0")],
    ["Đơn vị: VND. Số thực tế gồm VAT; tổng được tính từ số gốc rồi làm tròn."],
    ["Kế toán/tài chính", "", "", "Phụ trách bộ phận", "", "", "Người lập/Trưởng dự án"],
    ["", "", "", "", "", "", "", "", ""],
    ["Giám đốc"],
    ["Bản xuất truy nguồn hồ sơ; chưa phải bằng chứng ký hoặc xác nhận tiền thực tế."],
  ];
}

export function reimbursementXlsx(input: ReimbursementExport): Buffer {
  const rows = reimbursementRows(input);
  const content = rows.map((row, i) => `<row r="${i + 1}" ht="${i === 6 ? 55 : 30}" customHeight="1">${row.map((value, j) => {
    const ref = `${String.fromCharCode(65 + j)}${i + 1}`;
    const numeric = (i === 7 || i === 8) && j >= 4 && j <= 7 && /^\d{1,15}$/.test(value);
    return numeric ? `<c r="${ref}" s="2"><v>${value}</v></c>` : `<c r="${ref}" s="${[0,1,6,8,11,13].includes(i) ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return zip({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hoàn Tạm Ứng" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml": '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Times New Roman"/></font><font><b/><sz val="12"/><name val="Times New Roman"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0" xfId="0"><alignment wrapText="1" vertical="center"/></xf><xf fontId="1" xfId="0" applyFont="1"><alignment wrapText="1" vertical="center"/></xf><xf fontId="0" xfId="0" numFmtId="3" applyNumberFormat="1"><alignment horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="3" width="14" customWidth="1"/><col min="4" max="4" width="30" customWidth="1"/><col min="5" max="9" width="22" customWidth="1"/></cols><sheetData>${content}</sheetData><mergeCells count="4"><mergeCell ref="A2:I2"/><mergeCell ref="B10:I10"/><mergeCell ref="A11:I11"/><mergeCell ref="A15:I15"/></mergeCells><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="1"/></worksheet>`,
  });
}
