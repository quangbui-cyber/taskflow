import { prisma } from "@/lib/prisma";

/**
 * Quản lý nghỉ phép (Admin chọn ngay trong tab): duyệt đơn của người chưa có
 * quản lý trực tiếp và nhận thông báo kết quả của mọi đơn.
 */
export async function loadLeaveManagers(): Promise<
  Array<{ id: string; name: string }>
> {
  return prisma.user.findMany({
    where: { isLeaveManager: true, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
