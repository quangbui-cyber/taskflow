import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readXlsxUpload } from "@/lib/financeImportSave";
import { FinanceImportError } from "@/lib/financeImport";
import {
  HrImportError,
  birthdayFromDateOfBirth,
  canManageHr,
  formatHrDate,
  genderLabel,
  maskIdNumber,
  parseHrWorkbook,
  type HrImportPreviewRow,
  type HrImportRow,
} from "@/lib/employeeRecords";

export const runtime = "nodejs";
export const maxDuration = 60;

function rowWarnings(row: HrImportRow) {
  const warnings: string[] = [];
  if (row.idNumber && row.idNumber.length !== 12 && row.idNumber.length !== 9) {
    warnings.push(`CCCD có ${row.idNumber.length} số (CCCD chuẩn có 12 số)`);
  }
  if (!row.idNumber) warnings.push("Chưa có CCCD");
  if (!row.dateOfBirth) warnings.push("Chưa có ngày sinh");
  return warnings;
}

/**
 * Nhập Hồ sơ nhân sự từ file danh sách nhân viên xuất từ phần mềm HR.
 * - Không có `confirm`: chỉ đọc và trả về bản xem trước (CCCD đã che), không ghi gì.
 * - `confirm=1`: lưu cho các tài khoản đang hoạt động trùng email.
 * File chỉ được đọc trong bộ nhớ, không lưu lại.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
  }
  if (!canManageHr(user)) {
    return Response.json({ error: "Bạn không có quyền nhập hồ sơ nhân sự." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const upload = await readXlsxUpload(formData.get("file"));
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(
        upload.data.buffer.slice(
          upload.data.byteOffset,
          upload.data.byteOffset + upload.data.byteLength
        ) as ArrayBuffer
      );
    } catch {
      throw new HrImportError("Không mở được file. File có thể bị hỏng hoặc đặt mật khẩu.");
    }
    const rows = parseHrWorkbook(workbook);

    const emails = [...new Set(rows.map((row) => row.email).filter(Boolean))];
    const accounts = await prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        email: { in: emails, mode: "insensitive" },
      },
      select: { id: true, name: true, email: true, birthday: true },
    });
    const accountByEmail = new Map(accounts.map((account) => [account.email.toLowerCase(), account]));

    const matched = rows.flatMap((row) => {
      const account = row.hasLeft ? undefined : accountByEmail.get(row.email);
      return account ? [{ row, account }] : [];
    });

    if (formData.get("confirm") !== "1") {
      const preview: HrImportPreviewRow[] = rows.map((row, index) => {
        const account = row.hasLeft ? undefined : accountByEmail.get(row.email);
        return {
          key: `${row.employeeCode || "row"}-${index}`,
          employeeCode: row.employeeCode,
          fullName: row.fullName,
          email: row.email,
          outcome: row.hasLeft ? "left" : account ? "match" : "no-account",
          accountName: account?.name ?? null,
          gender: genderLabel(row.gender),
          dateOfBirth: formatHrDate(row.dateOfBirth),
          startDate: formatHrDate(row.startDate),
          idNumberMasked: maskIdNumber(row.idNumber),
          hasPhone: !!row.phone,
          hasAddress: !!row.address,
          warnings: account ? rowWarnings(row) : [],
        };
      });
      return Response.json({ fileName: upload.name, rows: preview, matchCount: matched.length });
    }

    // Ô trống trong file không xoá dữ liệu HR đã nhập tay.
    await prisma.$transaction(
      matched.flatMap(({ row, account }) => {
        const values = {
          fullName: row.fullName,
          ...(row.employeeCode ? { employeeCode: row.employeeCode } : {}),
          ...(row.dateOfBirth ? { dateOfBirth: row.dateOfBirth } : {}),
          ...(row.gender ? { gender: row.gender } : {}),
          ...(row.idNumber ? { idNumber: row.idNumber } : {}),
          ...(row.address ? { address: row.address } : {}),
          ...(row.phone ? { phone: row.phone } : {}),
          ...(row.startDate ? { startDate: row.startDate } : {}),
          updatedById: user.id,
        };
        return [
          prisma.employeeRecord.upsert({
            where: { userId: account.id },
            create: { userId: account.id, ...values },
            update: values,
          }),
          ...(row.dateOfBirth && !account.birthday
            ? [
                prisma.user.update({
                  where: { id: account.id },
                  data: { birthday: birthdayFromDateOfBirth(row.dateOfBirth) },
                }),
              ]
            : []),
        ];
      })
    );

    revalidatePath("/hr");
    revalidatePath("/");
    return Response.json({ saved: matched.length });
  } catch (error) {
    if (error instanceof HrImportError || error instanceof FinanceImportError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    // Không ghi nội dung file ra log vì có thông tin cá nhân.
    console.error("HR import failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Không nhập được file. Vui lòng thử lại." }, { status: 500 });
  }
}
