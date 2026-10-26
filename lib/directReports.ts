import type { Prisma } from "@prisma/client";

/**
 * Nhân viên trực thuộc một quản lý, chỉ tính tài khoản còn hoạt động.
 * Tài khoản bị vô hiệu hoá vẫn giữ managerId (để mở lại là về đúng chỗ),
 * và tài khoản xoá trước khi có bước gỡ quản lý cũng còn managerId — cả hai
 * không được tính vào "Nhân viên của tôi" hay số liệu báo cáo.
 */
export function activeDirectReportsWhere(managerId: string): Prisma.UserWhereInput {
  return { managerId, isActive: true, deletedAt: null };
}
