import JSZip from "jszip";

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

export async function preflightExcelWorkbook(bytes: Uint8Array, upload: ExcelWorkbookUpload) {
  const filename = upload.filename.trim();
  const mimeType = upload.mimeType ?? "";
  if (!/\.xlsx$/i.test(filename) || !ALLOWED_BROWSER_MIME.has(mimeType)) throw new Error("Chỉ chấp nhận tệp XLSX đúng định dạng.");
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("Tệp XLSX không có chữ ký ZIP hợp lệ.");
  if (bytes.length > EXCEL_INTAKE_LIMITS.compressedBytes) throw new Error("Tệp XLSX vượt giới hạn 4 MiB.");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true }); }
  catch { throw new Error("Tệp XLSX/ZIP không hợp lệ hoặc đã mã hóa."); }
  const entries = Object.values(zip.files);
  if (entries.length > EXCEL_INTAKE_LIMITS.entries) throw new Error("Tệp XLSX có quá nhiều thành phần.");
  const entryNames = new Set(entries.map(entry => entry.name.toLowerCase()));
  if (!entryNames.has("[content_types].xml") || !entryNames.has("xl/workbook.xml") || !entries.some(entry => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))) {
    throw new Error("Tệp XLSX thiếu thành phần workbook hoặc worksheet bắt buộc.");
  }
  let total = 0;
  for (const entry of entries) {
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (original.split(/[\\/]/).includes("..") || original.startsWith("/") || original.startsWith("\\")) throw new Error("Đường dẫn ZIP không an toàn.");
    if (FORBIDDEN_ENTRY.test(entry.name)) throw new Error("Tệp XLSX chứa macro, liên kết ngoài hoặc nội dung chủ động không được phép.");
    if (entry.dir) continue;
    const data = await entry.async("uint8array");
    if (data.byteLength > EXCEL_INTAKE_LIMITS.entryBytes) throw new Error("Một thành phần XLSX vượt giới hạn an toàn.");
    total += data.byteLength;
    if (total > EXCEL_INTAKE_LIMITS.uncompressedBytes) throw new Error("Tệp XLSX giải nén vượt giới hạn 32 MiB.");
    if (data.byteLength > Math.max(1024, bytes.length * EXCEL_INTAKE_LIMITS.compressionRatio)) throw new Error("Tệp XLSX có tỷ lệ nén bất thường.");
    if (/\.(?:xml|rels)$/i.test(entry.name)) {
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
