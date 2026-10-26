import JSZip from "jszip";
import { inflateRawSync } from "node:zlib";

export const EXCEL_INTAKE_LIMITS = {
  compressedBytes: 4 * 1024 * 1024,
  uncompressedBytes: 32 * 1024 * 1024,
  entries: 256,
  sheets: 32,
  rows: 500,
  columns: 40,
  textLength: 100_000,
  entryBytes: 16 * 1024 * 1024,
  compressionRatio: 200,
} as const;

const FORBIDDEN_ENTRY = /(?:vbaProject\.bin|activeX\/|embeddings\/|externalLinks\/|connections\.xml|oleObject|encryptedPackage|encryptionInfo)/i;
const OFFICIAL_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ALLOWED_BROWSER_MIME = new Set([OFFICIAL_XLSX_MIME, "", "application/octet-stream"]);
export type ExcelWorkbookUpload = { filename: string; mimeType?: string | null };

type CentralEntry = {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  directory: boolean;
};

function findEndOfCentralDirectory(bytes: Buffer) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Tệp XLSX/ZIP không có thư mục trung tâm hợp lệ.");
}

function readCentralEntries(bytes: Uint8Array): CentralEntry[] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralOffset = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("Tệp XLSX dùng ZIP64 không được hỗ trợ.");
  if (count > EXCEL_INTAKE_LIMITS.entries || centralOffset + centralSize > end) throw new Error("Tệp XLSX có thư mục ZIP không hợp lệ hoặc quá nhiều thành phần.");
  const entries: CentralEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Tệp XLSX có thư mục ZIP bị hỏng.");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) throw new Error("Tệp XLSX có metadata ZIP không hợp lệ.");
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localHeaderOffset, directory: name.endsWith("/") });
    offset = next;
  }
  if (offset !== centralOffset + centralSize) throw new Error("Tệp XLSX có kích thước thư mục ZIP không khớp.");
  return entries;
}

function inflateEntryBounded(bytes: Uint8Array, entry: CentralEntry) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error("Tệp XLSX có local header không hợp lệ.");
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw new Error("Tệp XLSX có dữ liệu ZIP bị cắt ngắn.");
  const compressed = buffer.subarray(start, end);
  let data: Buffer;
  if (entry.method === 0) data = Buffer.from(compressed);
  else if (entry.method === 8) {
    try { data = inflateRawSync(compressed, { maxOutputLength: EXCEL_INTAKE_LIMITS.entryBytes + 1 }); }
    catch { throw new Error("Một thành phần XLSX giải nén vượt giới hạn hoặc bị hỏng."); }
  } else throw new Error("Tệp XLSX dùng phương thức nén không được hỗ trợ.");
  if (data.byteLength !== entry.uncompressedSize) throw new Error("Kích thước thành phần XLSX không khớp metadata ZIP.");
  return data;
}

export async function preflightExcelWorkbook(bytes: Uint8Array, upload: ExcelWorkbookUpload) {
  const filename = upload.filename.trim();
  const mimeType = upload.mimeType ?? "";
  if (!/\.xlsx$/i.test(filename) || !ALLOWED_BROWSER_MIME.has(mimeType)) throw new Error("Chỉ chấp nhận tệp XLSX đúng định dạng.");
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("Tệp XLSX không có chữ ký ZIP hợp lệ.");
  if (bytes.length > EXCEL_INTAKE_LIMITS.compressedBytes) throw new Error("Tệp XLSX vượt giới hạn 4 MiB.");
  const centralEntries = readCentralEntries(bytes);
  if (centralEntries.some(entry => (entry.flags & 0x1) !== 0)) throw new Error("Tệp XLSX/ZIP đã mã hóa không được hỗ trợ.");
  const declaredTotal = centralEntries.reduce((sum, entry) => sum + (entry.directory ? 0 : entry.uncompressedSize), 0);
  if (declaredTotal > EXCEL_INTAKE_LIMITS.uncompressedBytes) throw new Error("Tệp XLSX giải nén vượt giới hạn 32 MiB.");
  for (const entry of centralEntries) {
    if (entry.uncompressedSize > EXCEL_INTAKE_LIMITS.entryBytes) throw new Error("Một thành phần XLSX vượt giới hạn an toàn.");
    if (!entry.directory && entry.uncompressedSize > Math.max(1024, entry.compressedSize * EXCEL_INTAKE_LIMITS.compressionRatio)) throw new Error("Tệp XLSX có tỷ lệ nén bất thường.");
  }
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true }); }
  catch { throw new Error("Tệp XLSX/ZIP không hợp lệ hoặc đã mã hóa."); }
  const entries = Object.values(zip.files);
  if (entries.length > EXCEL_INTAKE_LIMITS.entries) throw new Error("Tệp XLSX có quá nhiều thành phần.");
  const entryNames = new Set(entries.map(entry => entry.name.toLowerCase()));
  if (!entryNames.has("[content_types].xml") || !entryNames.has("xl/workbook.xml") || !entries.some(entry => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))) {
    throw new Error("Tệp XLSX thiếu thành phần workbook hoặc worksheet bắt buộc.");
  }
  for (const centralEntry of centralEntries) {
    const original = centralEntry.name;
    if (original.split(/[\\/]/).includes("..") || original.startsWith("/") || original.startsWith("\\")) throw new Error("Đường dẫn ZIP không an toàn.");
    if (FORBIDDEN_ENTRY.test(centralEntry.name)) throw new Error("Tệp XLSX chứa macro, liên kết ngoài hoặc nội dung chủ động không được phép.");
    if (centralEntry.directory) continue;
    const data = inflateEntryBounded(bytes, centralEntry);
    if (/\.(?:xml|rels)$/i.test(centralEntry.name)) {
      const xml = Buffer.from(data).toString("utf8");
      if (xml.length > EXCEL_INTAKE_LIMITS.textLength * 32) throw new Error("Nội dung văn bản XLSX vượt giới hạn.");
      if (/\b(?:DDE|DDEAUTO)\b|TargetMode=["']External["']/i.test(xml)) throw new Error("Tệp XLSX chứa liên kết ngoài hoặc DDE không được phép.");
    }
  }
  const contentTypesEntry = zip.file("[Content_Types].xml") ?? entries.find(entry => entry.name.toLowerCase() === "[content_types].xml");
  const contentTypes = contentTypesEntry ? await contentTypesEntry.async("string") : "";
  if (!/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\.main\+xml/i.test(contentTypes) ||
      !/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.worksheet\+xml/i.test(contentTypes) ||
      /macroEnabled|vbaProject|activeX|oleObject/i.test(contentTypes)) {
    throw new Error("Khai báo nội dung OpenXML không hợp lệ hoặc chứa nội dung chủ động.");
  }
  const sheetCount = entries.filter(entry => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name)).length;
  if (sheetCount > EXCEL_INTAKE_LIMITS.sheets) throw new Error("Tệp XLSX có quá nhiều sheet.");
  return zip;
}
