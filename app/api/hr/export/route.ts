import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageHr, formatHrDate, genderLabel } from "@/lib/employeeRecords";

export const runtime = "nodejs";

/**
 * Xuất danh sách hồ sơ nhân sự hiện tại của công ty ra file Excel (.xlsx).
 * File này chứa danh sách tất cả nhân sự đang hoạt động và có thể dùng để điền/cập nhật,
 * sau đó nhập lại qua nút "Nhập từ Excel".
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Phiên đăng nhập đã hết hạn.", { status: 401 });
  }
  if (!canManageHr(user)) {
    return new Response("Bạn không có quyền tải hồ sơ nhân sự.", { status: 403 });
  }

  const people = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      employeeRecord: {
        select: {
          fullName: true,
          gender: true,
          dateOfBirth: true,
          idNumber: true,
          address: true,
          phone: true,
          startDate: true,
          employeeCode: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TaskFlow";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Hồ sơ nhân sự", {
    views: [{ showGridLines: true }],
  });

  // Thiết lập các cột
  worksheet.columns = [
    { header: "STT", key: "index", width: 6 },
    { header: "Họ và tên", key: "fullName", width: 26 },
    { header: "Email", key: "email", width: 30 },
    { header: "Giới tính", key: "gender", width: 12 },
    { header: "Ngày sinh", key: "dateOfBirth", width: 14 },
    { header: "Số CCCD", key: "idNumber", width: 18 },
    { header: "Điện thoại", key: "phone", width: 16 },
    { header: "Địa chỉ", key: "address", width: 36 },
    { header: "Ngày bắt đầu làm việc", key: "startDate", width: 22 },
    { header: "Mã nhân sự", key: "employeeCode", width: 14 },
  ];

  // Định dạng dòng tiêu đề (Header)
  const headerRow = worksheet.getRow(1);
  headerRow.height = 28;
  headerRow.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF1D1D1F" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF0F4E8" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FFD4D8DF" } },
      left: { style: "thin", color: { argb: "FFD4D8DF" } },
      bottom: { style: "medium", color: { argb: "FFA8D431" } },
      right: { style: "thin", color: { argb: "FFD4D8DF" } },
    };
  });

  // Thêm từng dòng nhân sự
  people.forEach((person, idx) => {
    const record = person.employeeRecord;
    const row = worksheet.addRow({
      index: idx + 1,
      fullName: record?.fullName || person.name,
      email: person.email,
      gender: genderLabel(record?.gender),
      dateOfBirth: formatHrDate(record?.dateOfBirth),
      idNumber: record?.idNumber ? String(record.idNumber) : "",
      phone: record?.phone ? String(record.phone) : "",
      address: record?.address || "",
      startDate: formatHrDate(record?.startDate),
      employeeCode: record?.employeeCode || "",
    });

    row.height = 22;
    row.font = { name: "Arial", size: 10, color: { argb: "FF1D1D1F" } };
    row.alignment = { vertical: "middle" };

    // Định dạng căn chỉnh theo từng loại dữ liệu
    row.getCell("index").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("fullName").alignment = { vertical: "middle", horizontal: "left" };
    row.getCell("email").alignment = { vertical: "middle", horizontal: "left" };
    row.getCell("gender").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("dateOfBirth").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("idNumber").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("phone").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("address").alignment = { vertical: "middle", horizontal: "left" };
    row.getCell("startDate").alignment = { vertical: "middle", horizontal: "center" };
    row.getCell("employeeCode").alignment = { vertical: "middle", horizontal: "center" };

    // Đảm bảo CCCD và Điện thoại luôn giữ kiểu chuỗi để tránh mất số 0 đầu
    row.getCell("idNumber").numFmt = "@";
    row.getCell("phone").numFmt = "@";

    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E5EA" } },
        left: { style: "thin", color: { argb: "FFE2E5EA" } },
        bottom: { style: "thin", color: { argb: "FFE2E5EA" } },
        right: { style: "thin", color: { argb: "FFE2E5EA" } },
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `danh-sach-ho-so-nhan-su-${dateStr}.xlsx`;

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
