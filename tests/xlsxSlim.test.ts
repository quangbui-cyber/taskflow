import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { slimXlsx } from "../lib/xlsxSlim";
import { parseFinanceWorkbook } from "../lib/financeImport";

// Ảnh PNG "nặng": đầu file PNG thật + dữ liệu ngẫu nhiên (không nén được), như ảnh chụp chuyển khoản.
const PNG_HEADER = Buffer.from("89504e470d0a1a0a", "hex");
const heavyPng = () => Buffer.concat([PNG_HEADER, randomBytes(300 * 1024)]);

async function workbookFile(withImages: number) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("AC");
  ["STT", "HẠNG MỤC", "MÔ TẢ", "ĐVT", "SỐ LƯỢNG", "ĐƠN GIÁ", "THÀNH TIỀN", "GHI CHÚ"].forEach((label, index) => {
    sheet.getRow(8).getCell(index + 1).value = label;
  });
  ["ĐVT", "SỐ LƯỢNG", "ĐƠN GIÁ", "THÀNH TIỀN", "VAT", "TỔNG CỘNG", "SUP", "GHI CHÚ"].forEach((label, index) => {
    sheet.getRow(8).getCell(index + 10).value = label;
  });
  sheet.getCell("A9").value = "I. SẢN XUẤT";
  sheet.getCell("A10").value = 1;
  sheet.getCell("B10").value = "Sân khấu";
  sheet.getCell("E10").value = 1;
  sheet.getCell("F10").value = 45_000_000;
  sheet.getCell("K10").value = 1;
  sheet.getCell("L10").value = 32_000_000;
  sheet.getCell("A11").value = "TỔNG TIỀN";
  const receipts = workbook.addWorksheet("Chuyển khoản");
  for (let index = 0; index < withImages; index += 1) {
    const imageId = workbook.addImage({ buffer: heavyPng() as unknown as ExcelJS.Buffer, extension: "png" });
    receipts.addImage(imageId, { tl: { col: 0, row: index * 20 }, ext: { width: 300, height: 400 } });
  }
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  return new File([buffer], "AC_test.xlsx");
}

async function parse(file: File) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return { workbook, result: parseFinanceWorkbook(workbook, { suppliers: [], clientNames: [] }) };
}

test("slimXlsx replaces pasted images so the upload is much smaller but reads the same", async () => {
  const original = await workbookFile(3);
  const slim = await slimXlsx(original);
  assert.equal(slim.removedImages, 3);
  assert.equal(slim.originalSize, original.size);
  assert.ok(slim.slimSize < original.size / 10, `${slim.slimSize} vs ${original.size}`);
  assert.equal(slim.file.name, original.name);

  const before = await parse(original);
  const after = await parse(slim.file);
  assert.deepEqual(after.result, before.result);
  // Sheet và chỗ đặt ảnh vẫn còn, chỉ ảnh là bản 1×1 hợp lệ.
  assert.deepEqual(after.workbook.worksheets.map((sheet) => sheet.name), ["AC", "Chuyển khoản"]);
  const zip = await JSZip.loadAsync(await slim.file.arrayBuffer());
  const media = Object.keys(zip.files).filter((path) => path.startsWith("xl/media/") && !zip.files[path].dir);
  assert.equal(media.length, 3);
  for (const path of media) {
    const bytes = await zip.files[path].async("uint8array");
    assert.ok(bytes.length < 200);
    assert.deepEqual([...bytes.subarray(0, 8)], [...PNG_HEADER]);
  }
});

test("slimXlsx returns the original file when there is nothing to remove", async () => {
  const original = await workbookFile(0);
  const slim = await slimXlsx(original);
  assert.equal(slim.file, original);
  assert.equal(slim.removedImages, 0);
  assert.equal(slim.slimSize, original.size);
});

test("slimXlsx rejects files that are not zip-based .xlsx", async () => {
  await assert.rejects(slimXlsx(new File([Buffer.from("not a spreadsheet")], "x.xlsx")));
});
