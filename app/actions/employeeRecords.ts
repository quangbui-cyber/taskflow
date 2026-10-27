"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  FIELD_LIMITS,
  GENDERS,
  birthdayFromDateOfBirth,
  canManageHr,
  normalizeIdNumber,
  normalizePersonName,
  normalizePhone,
  parseHrDate,
} from "@/lib/employeeRecords";

export type EmployeeRecordState = { error?: string; success?: string };

const genderKeys = new Set<string>(GENDERS.map((gender) => gender.key));

/** HR/Admin lưu hồ sơ nhân sự của một tài khoản đang hoạt động. */
export async function saveEmployeeRecord(
  _previous: EmployeeRecordState,
  formData: FormData
): Promise<EmployeeRecordState> {
  const user = await requireUser();
  if (!canManageHr(user)) return { error: "Bạn không có quyền sửa hồ sơ nhân sự." };

  const userId = String(formData.get("userId") ?? "");
  const fullName = normalizePersonName(formData.get("fullName"));
  const gender = String(formData.get("gender") ?? "");
  const idNumber = normalizeIdNumber(formData.get("idNumber"));
  const phone = normalizePhone(formData.get("phone"));
  const address = String(formData.get("address") ?? "").normalize("NFC").trim();
  const dobText = String(formData.get("dateOfBirth") ?? "");
  const startText = String(formData.get("startDate") ?? "");
  const dateOfBirth = dobText ? parseHrDate(dobText) : null;
  const startDate = startText ? parseHrDate(startText) : null;

  if (!fullName) return { error: "Hãy nhập họ tên." };
  if (fullName.length > FIELD_LIMITS.fullName) return { error: "Họ tên quá dài." };
  if (gender && !genderKeys.has(gender)) return { error: "Giới tính không hợp lệ." };
  if (dobText && !dateOfBirth) return { error: "Ngày sinh không hợp lệ." };
  if (startText && !startDate) return { error: "Ngày bắt đầu làm việc không hợp lệ." };
  if (idNumber.length > FIELD_LIMITS.idNumber) return { error: "Số CCCD quá dài." };
  if (phone.length > FIELD_LIMITS.phone) return { error: "Số điện thoại quá dài." };
  if (address.length > FIELD_LIMITS.address) return { error: "Địa chỉ quá dài." };

  const target = await prisma.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    select: { id: true, birthday: true },
  });
  if (!target) return { error: "Không tìm thấy nhân sự đang hoạt động." };

  const data = {
    fullName,
    gender: gender || null,
    idNumber: idNumber || null,
    phone: phone || null,
    address: address || null,
    dateOfBirth,
    startDate,
    updatedById: user.id,
  };
  await prisma.$transaction([
    prisma.employeeRecord.upsert({
      where: { userId: target.id },
      create: { userId: target.id, ...data },
      update: data,
    }),
    // Ngày sinh từ HR điền luôn sinh nhật (ngày/tháng) nếu người đó chưa tự khai.
    ...(dateOfBirth && !target.birthday
      ? [
          prisma.user.update({
            where: { id: target.id },
            data: { birthday: birthdayFromDateOfBirth(dateOfBirth) },
          }),
        ]
      : []),
  ]);

  revalidatePath("/hr");
  revalidatePath("/");
  return { success: "Đã lưu hồ sơ nhân sự." };
}

/** Admin đặt lại danh sách người phụ trách nhân sự. */
export async function setHrManagers(userIds: string[]): Promise<EmployeeRecordState> {
  await requireAdmin();
  if (
    !Array.isArray(userIds) ||
    userIds.length > 20 ||
    userIds.some((id) => typeof id !== "string" || !id)
  ) {
    return { error: "Danh sách người phụ trách không hợp lệ." };
  }
  const ids = [...new Set(userIds)];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (users.length !== ids.length) {
    return { error: "Có tài khoản không tồn tại hoặc đã bị vô hiệu hoá." };
  }
  await prisma.$transaction([
    prisma.user.updateMany({
      where: { isHrManager: true, id: { notIn: ids } },
      data: { isHrManager: false },
    }),
    prisma.user.updateMany({ where: { id: { in: ids } }, data: { isHrManager: true } }),
  ]);
  revalidatePath("/hr");
  return { success: "Đã lưu người phụ trách nhân sự." };
}
