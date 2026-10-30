import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  HrImportError,
  birthdayFromDateOfBirth,
  canManageHr,
  joinAddress,
  maskIdNumber,
  normalizeIdNumber,
  normalizePersonName,
  normalizePhone,
  parseGender,
  parseHrDate,
  parseHrWorkbook,
} from "../lib/employeeRecords";

// Dữ liệu giả, cùng bố cục với file xuất từ phần mềm HR.
function sampleWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const overview = workbook.addWorksheet("Tổng quan");
  overview.addRow([
    "Tên nhân sự", "Mã nhân sự", "Tài khoản", "Trạng thái", "Ngày bắt đầu", "Giới tính",
    "Điện thoại", "Địa chỉ email", "Ngày sinh", "Ngày nghỉ việc",
  ]);
  overview.addRow(["NGUYỄN VĂN AN", "NV001", "@an", "Chính thức", "03/08/2026", "Nam", "0901234567", "An.Nguyen@Example.vn", "09/11/2000", null]);
  overview.addRow(["Trần Thị Bình", "NV002", null, "Nghỉ việc", "01/02/2024", "Nữ", 912345678, "binh@example.vn", "31/12/1999", "05/05/2025"]);
  overview.addRow(["LÊ CƯỜNG", "NV003", null, "Chính thức", "2025-01-15", "Khác", null, "", "32/01/2000", null]);
  const legals = workbook.addWorksheet("Legals");
  legals.addRow(["Tên nhân sự", "Mã nhân sự", "Số CMT/Căn cước", "Địa chỉ"]);
  legals.addRow(["NGUYỄN VĂN AN", "NV001", 79204001234, "12 Lê Lợi, Quận 1"]);
  legals.addRow(["LÊ CƯỜNG", "NV003", "0792-0400-5678", "Huế"]);
  const details = workbook.addWorksheet("Nhân viên");
  details.addRow(["Tên nhân sự", "Mã nhân sự", "Địa chỉ email", "Địa chỉ", "Địa chỉ tỉnh/tp", "Địa chỉ xã/phường"]);
  details.addRow(["NGUYỄN VĂN AN", "NV001", "an.nguyen@example.vn", "12 Lê Lợi", "Thành phố Hồ Chí Minh", "Phường Bến Thành"]);
  workbook.addWorksheet("Lương").addRow(["Tên nhân sự", "Số tài khoản Ngân hàng"]);
  return workbook;
}

test("HR access is Admin or HR manager only", () => {
  assert.equal(canManageHr({ role: "ADMIN" }), true);
  assert.equal(canManageHr({ role: "USER", isHrManager: true }), true);
  assert.equal(canManageHr({ role: "ACCOUNTANT", isHrManager: false }), false);
  assert.equal(canManageHr({ role: "USER" }), false);
});

test("names, ids and phones are normalized", () => {
  assert.equal(normalizePersonName("LÊ HỒNG YẾN NHI"), "Lê Hồng Yến Nhi");
  assert.equal(normalizePersonName("Nguyễn Minh Đăng"), "Nguyễn Minh Đăng");
  assert.equal(normalizeIdNumber(79204001234), "079204001234");
  assert.equal(normalizeIdNumber(" 0792-0400 5678 "), "079204005678");
  assert.equal(normalizePhone(912345678), "0912345678");
  assert.equal(normalizePhone("090 123 4567"), "0901234567");
  assert.equal(maskIdNumber("079204001234"), "•••• 1234");
  assert.equal(maskIdNumber(null), "");
});

test("dates and genders parse strictly", () => {
  assert.deepEqual(parseHrDate("09/11/2003"), new Date(Date.UTC(2003, 10, 9)));
  assert.deepEqual(parseHrDate("2025-01-15"), new Date(Date.UTC(2025, 0, 15)));
  assert.equal(parseHrDate("32/01/2000"), null);
  assert.equal(parseHrDate("29/02/2023"), null);
  assert.equal(parseHrDate(""), null);
  assert.equal(parseGender("Nữ"), "FEMALE");
  assert.equal(parseGender("Nam"), "MALE");
  assert.equal(parseGender(""), null);
  assert.deepEqual(birthdayFromDateOfBirth(new Date(Date.UTC(2003, 10, 9))), new Date(Date.UTC(2000, 10, 9)));
});

test("address parts are joined without repeating", () => {
  assert.equal(
    joinAddress(["315C Lý Thường Kiệt, Phường Mỹ Tho", "Phường Mỹ Tho", "Tỉnh Đồng Tháp"]),
    "315C Lý Thường Kiệt, Phường Mỹ Tho, Tỉnh Đồng Tháp"
  );
});

test("HR export is parsed across sheets by employee code", () => {
  const rows = parseHrWorkbook(sampleWorkbook());
  assert.equal(rows.length, 3);
  const [an, binh, cuong] = rows;
  assert.equal(an.fullName, "Nguyễn Văn An");
  assert.equal(an.email, "an.nguyen@example.vn");
  assert.equal(an.idNumber, "079204001234");
  assert.equal(an.address, "12 Lê Lợi, Phường Bến Thành, Thành phố Hồ Chí Minh");
  assert.equal(an.gender, "MALE");
  assert.deepEqual(an.startDate, new Date(Date.UTC(2026, 7, 3)));
  assert.equal(an.hasLeft, false);
  assert.equal(binh.hasLeft, true);
  assert.equal(binh.phone, "0912345678");
  assert.equal(cuong.address, "Huế");
  assert.equal(cuong.dateOfBirth, null);
  assert.equal(cuong.email, "");
});

test("single-sheet employee list format is parsed directly", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hồ sơ nhân sự");
  sheet.addRow([
    "STT", "Họ và tên", "Email", "Giới tính", "Ngày sinh", "Số CCCD", "Điện thoại", "Địa chỉ", "Ngày bắt đầu làm việc", "Mã nhân sự",
  ]);
  sheet.addRow([
    1, "Lê Hồng Yến Nhi", "nhi.le@example.vn", "Nữ", "15/08/1998", "079301009876", "0987654321", "Quận 3, TP.HCM", "01/06/2023", "NV042",
  ]);
  const rows = parseHrWorkbook(workbook);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fullName, "Lê Hồng Yến Nhi");
  assert.equal(rows[0].email, "nhi.le@example.vn");
  assert.equal(rows[0].gender, "FEMALE");
  assert.equal(rows[0].idNumber, "079301009876");
  assert.equal(rows[0].phone, "0987654321");
  assert.equal(rows[0].address, "Quận 3, TP.HCM");
  assert.deepEqual(rows[0].dateOfBirth, new Date(Date.UTC(1998, 7, 15)));
  assert.deepEqual(rows[0].startDate, new Date(Date.UTC(2023, 5, 1)));
  assert.equal(rows[0].employeeCode, "NV042");
});

test("a workbook without employee headers is rejected", () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Sheet1").addRow(["A", "B"]);
  assert.throws(() => parseHrWorkbook(workbook), HrImportError);
});
