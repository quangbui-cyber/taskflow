import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";

export async function getCurrentUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return prisma.user.findFirst({
    where: { id: userId, isActive: true },
    select: { id: true, email: true, name: true, role: true, avatarUrl: true },
  });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  return user;
}

/** ADMIN và ACCOUNT được tạo project & xem doanh số; USER thì không */
export function canManageProjects(role: string) {
  return role === "ADMIN" || role === "ACCOUNT";
}

/** Như requireUser nhưng chặn luôn role USER (dùng cho trang doanh số, tạo project) */
export async function requireProjectManager() {
  const user = await requireUser();
  if (!canManageProjects(user.role)) redirect("/");
  return user;
}

/** Kiểm tra user là thành viên của project, trả về membership hoặc null */
export async function getMembership(projectId: string, userId: string) {
  return prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
}
