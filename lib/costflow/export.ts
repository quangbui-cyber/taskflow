import { moneyInWords } from "./money";
import type { RequestPayload } from "./types";

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
