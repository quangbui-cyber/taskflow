import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { FinanceImportError, parseFinanceWorkbook } from "../lib/financeImport";

// File mẫu tự dựng theo đúng bố cục file IC/AC của công ty (không dùng file thật
// vì có thông tin chuyển khoản).

type CellInput = string | number | { formula: string; result?: number } | { error: string } | Date | null;

function put(sheet: ExcelJS.Worksheet, address: string, value: CellInput) {
  sheet.getCell(address).value = value as ExcelJS.CellValue;
}

/** Mẫu IC (như file Vietjet): Báo giá A–H, IC J–Q, có nhóm La Mã. */
function icWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("OldClient");
  put(sheet, "A1", "IC");
  put(sheet, "A3", "Khách hàng: ");
  put(sheet, "B3", "Vietjet");
  put(sheet, "A4", "Thời gian:");
  put(sheet, "B4", "01/08/2026");
  put(sheet, "A5", "Số lượng:");
  put(sheet, "A6", "Địa điểm:");
  const headers: [string, string][] = [
    ["A8", "STT"], ["B8", "HẠNG MỤC"], ["C8", "MÔ TẢ"], ["D8", "ĐVT"], ["E8", "SỐ LƯỢNG"], ["F8", "ĐƠN GIÁ"], ["G8", "THÀNH TIỀN"], ["H8", "GHI CHÚ"],
    ["J8", "ĐVT"], ["K8", "SỐ LƯỢNG"], ["L8", "ĐƠN GIÁ"], ["M8", "THÀNH TIỀN"], ["N8", "VAT"], ["O8", "TỔNG CỘNG"], ["P8", "SUP"], ["Q8", "GHI CHÚ"],
    ["S8", "SUP"], ["T8", "TỔNG CỘNG"],
  ];
  for (const [address, label] of headers) put(sheet, address, label);

  put(sheet, "A9", "I. SẢN XUẤT");
  put(sheet, "G9", { formula: "SUBTOTAL(9,G10:G11)", result: 4_400_000 });
  // 1. Hạng mục thường
  put(sheet, "A10", 1); put(sheet, "B10", "Lót gối tựa đầu ghế"); put(sheet, "D10", "Cái"); put(sheet, "E10", 240); put(sheet, "F10", 22_000);
  put(sheet, "G10", { formula: "E10*F10", result: 5_280_000 });
  put(sheet, "J10", "Cái"); put(sheet, "K10", 240); put(sheet, "L10", 12_000);
  put(sheet, "M10", { formula: "K10*L10", result: 2_880_000 }); put(sheet, "N10", { formula: "M10*8%", result: 230_400 }); put(sheet, "P10", "DEMO IN");
  // 2. Margin bất thường, VAT ra số lẻ
  put(sheet, "A11", 2); put(sheet, "B11", "Sticker cờ"); put(sheet, "D11", "Gói"); put(sheet, "E11", 1); put(sheet, "F11", 500_000);
  put(sheet, "G11", { formula: "E11*F11", result: 999_999 }); // sai so với 1 × 500.000
  put(sheet, "K11", 1); put(sheet, "L11", 28_001); put(sheet, "M11", { formula: "K11*L11", result: 28_001 }); put(sheet, "N11", { formula: "M11*8%", result: 2240.08 });

  put(sheet, "A12", "II. NHÂN SỰ");
  // 1. Không VAT đầu vào
  put(sheet, "A13", 1); put(sheet, "B13", "Biên đạo"); put(sheet, "E13", 1); put(sheet, "F13", 8_000_000); put(sheet, "G13", { formula: "E13*F13", result: 8_000_000 });
  put(sheet, "K13", 1); put(sheet, "L13", 5_000_000); put(sheet, "M13", { formula: "K13*L13", result: 5_000_000 });
  // Công thức dừng giữa chừng (như SUMIF($P$9:$P$13) trong file Vietjet)
  put(sheet, "T10", { formula: "SUMIF($P$9:$P$11,S10,$O$9:$O$11)", result: 0 });

  put(sheet, "A14", "TỔNG TIỀN"); put(sheet, "G14", { formula: "SUBTOTAL(9,G9:G13)", result: 13_780_000 });
  put(sheet, "A15", "VAT (8%)");
  return workbook;
}

/** Mẫu AC (như file Jabil): Báo giá, Nghiệm thu, IC, AC có nhãn khối; dòng chi phí con. */
function acWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("AC");
  put(sheet, "A1", "AC");
  put(sheet, "A3", "Khách hàng:"); put(sheet, "B3", "Khách Demo");
  put(sheet, "A4", "Thời gian: "); put(sheet, "B4", new Date("2026-04-09T00:00:00Z"));
  put(sheet, "A5", "Dự án"); put(sheet, "B5", "3D Figures");
  put(sheet, "A7", "BÁO GIÁ"); put(sheet, "J7", "NGHIỆM THU"); put(sheet, "S7", "INTERNAL COST"); put(sheet, "AA7", "ACTUAL COST");
  const sell = ["STT", "HẠNG MỤC", "Mô tả", "ĐVT", "SỐ LƯỢNG", "ĐƠN \nGIÁ", "THÀNH TIỀN", "GHI CHÚ"];
  sell.forEach((label, index) => {
    put(sheet, `${String.fromCharCode(65 + index)}8`, label);
    put(sheet, `${String.fromCharCode(74 + index)}8`, label);
  });
  const cost = ["ĐVT", "SỐ LƯỢNG", "ĐƠN \nGIÁ", "THÀNH TIỀN", "VAT", "TỔNG CỘNG", "SUP"];
  const ic = ["S", "T", "U", "V", "W", "X", "Y"];
  const ac = ["AA", "AB", "AC", "AD", "AE", "AF", "AG"];
  cost.forEach((label, index) => {
    put(sheet, `${ic[index]}8`, label);
    put(sheet, `${ac[index]}8`, label);
  });

  // 1. Hạng mục bán, giá nhập kiểu =2160000/1.08, chi phí ở các dòng con
  put(sheet, "A9", "1"); put(sheet, "B9", "Tượng 3D quà tặng"); put(sheet, "D9", "tượng"); put(sheet, "E9", 68);
  put(sheet, "F9", { formula: "2160000/1.08", result: 1_999_999.9999999998 });
  put(sheet, "G9", { formula: "E9*F9", result: 135_999_999.99999997 });
  put(sheet, "C10", "Chi phí sản xuất tượng"); put(sheet, "S10", "tượng"); put(sheet, "T10", 68); put(sheet, "U10", 1_429_738.5588235294);
  put(sheet, "V10", { formula: "U10*T10", result: 97_222_222 }); put(sheet, "W10", { formula: "V10*8%", result: 7_777_777.76 }); put(sheet, "Y10", "DEMO TƯỢNG");
  put(sheet, "AB10", 68); put(sheet, "AC10", 1_429_738.5588235294);
  put(sheet, "C11", "Chi phí đổi mặt"); put(sheet, "T11", 1); put(sheet, "V11", { formula: "U11*T11", result: 0 }); put(sheet, "W11", { formula: "V11*8%", result: 0 });
  put(sheet, "AB11", 1); put(sheet, "AC11", 100_000);
  // 3. Không tính tiền khách ("-"), STT nhảy từ 1 lên 3
  put(sheet, "A12", "3"); put(sheet, "B12", "Chi phí vận chuyển"); put(sheet, "E12", 1); put(sheet, "G12", "-");
  put(sheet, "T12", 1); put(sheet, "U12", 1_000_000); put(sheet, "V12", { formula: "U12*T12", result: 1_000_000 }); put(sheet, "W12", { formula: "0", result: 0 }); put(sheet, "Y12", "HUY");
  put(sheet, "AB12", 1); put(sheet, "AC12", 3_690_000);

  put(sheet, "A13", "TỔNG TIỀN"); put(sheet, "G13", { formula: "SUBTOTAL(9,G9:G12)", result: 135_999_999.99999997 });
  put(sheet, "V13", { formula: "SUBTOTAL(9,V10:V12)", result: 98_222_222 });
  put(sheet, "A15", "VAT (8%)");

  const logistic = workbook.addWorksheet("Logistic");
  put(logistic, "A1", "STT"); put(logistic, "F2", { error: "#VALUE!" }); put(logistic, "F3", { error: "#VALUE!" });
  return workbook;
}

const context = {
  suppliers: [
    { id: "s-in", name: "Công ty Demo In", shortName: "DEMO IN" },
    { id: "s-tuong", name: "Công ty Demo Tượng", shortName: "DEMO TƯỢNG" },
  ],
  clientNames: ["OldClient Việt Nam", "Vietjet"],
};

const codes = (result: ReturnType<typeof parseFinanceWorkbook>) => result.issues.map((issue) => issue.code);

test("IC layout: header, groups, items and costs are read by column title", () => {
  const result = parseFinanceWorkbook(icWorkbook(), context);
  assert.equal(result.sheetName, "OldClient");
  assert.deepEqual(result.header, {
    clientName: "Vietjet",
    programName: "",
    headcount: "",
    location: "",
    eventStart: "2026-08-01",
    eventEnd: "",
  });
  assert.equal(result.sellVatRate, 0.08);
  assert.deepEqual(result.sections.map((section) => section.name), ["I. SẢN XUẤT", "II. NHÂN SỰ"]);
  const [gối, sticker] = result.sections[0].lines;
  assert.equal(gối.name, "Lót gối tựa đầu ghế");
  assert.equal(gối.unitPrice, 22_000);
  assert.deepEqual(
    { q: gối.costs[0].icQuantity, p: gối.costs[0].icUnitPrice, vat: gối.costs[0].icVatRate, supplier: gối.costs[0].icSupplierId },
    { q: 240, p: 12_000, vat: 0.08, supplier: "s-in" },
  );
  assert.equal(sticker.costs[0].icSupplierId, null);
  assert.equal(result.sections[1].lines[0].costs[0].icVatRate, null);
  assert.equal(result.hasAcceptance, false);
  assert.equal(result.totals.sellSubtotal, 13_780_000);
});

test("IC layout: the code checks catch the known mistakes", () => {
  const result = parseFinanceWorkbook(icWorkbook(), context);
  const found = codes(result);
  for (const code of ["R01", "F01", "C01", "C03", "C05", "B02", "B04", "B07"]) {
    assert.ok(found.includes(code), `thiếu ${code}: ${found.join(", ")}`);
  }
  assert.ok(!found.includes("C08"), "DEMO IN có trong danh bạ");
  assert.equal(result.issues[0].severity, "error", "lỗi xếp trước");
  const f01 = result.issues.find((issue) => issue.code === "F01");
  assert.match(f01?.title ?? "", /dòng 11/);
});

test("AC layout: blocks are found by their labels and sub-rows become cost lines", () => {
  const result = parseFinanceWorkbook(acWorkbook(), context);
  assert.equal(result.header.programName, "3D Figures");
  assert.equal(result.header.eventStart, "2026-04-09");
  assert.equal(result.hasAcceptance, true);
  assert.equal(result.acCostTotal, 97_222_222 + 100_000 + 3_690_000);
  const [tượng, vậnChuyển] = result.sections[0].lines;
  assert.equal(tượng.unitPrice, 2_000_000);
  assert.deepEqual(
    tượng.costs.map((cost) => [cost.description, cost.icQuantity, cost.icUnitPrice, cost.icVatRate]),
    [
      ["Chi phí sản xuất tượng", 68, 1_429_738.56, 0.08],
      ["Chi phí đổi mặt", 1, null, 0.08],
    ],
  );
  assert.equal(vậnChuyển.unitPrice, null, '"-" nghĩa là không tính tiền khách');
  assert.equal(vậnChuyển.costs[0].icVatRate, null);
  assert.equal(result.totals.sellSubtotal, 136_000_000);
  assert.equal(result.totals.costSubtotal, 98_222_222);
  assert.deepEqual(result.unmatchedSuppliers, ["HUY"]);
  const found = codes(result);
  for (const code of ["F04", "C07", "C08"]) assert.ok(found.includes(code), `thiếu ${code}`);
  assert.ok(!found.includes("R01") && !found.includes("R03"), "số tròn của Excel không bị báo sai");
});

test("a file without the IC table is rejected with a clear message", () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Sheet1").getCell("A1").value = "Danh sách khách mời";
  assert.throws(() => parseFinanceWorkbook(workbook, context), FinanceImportError);
});
