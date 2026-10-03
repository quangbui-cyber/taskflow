import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewRevenue } from "@/lib/projectPolicy";

export { canCreateProjects, canViewRevenue } from "@/lib/projectPolicy";

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  return prisma.user.findFirst({
    where: {
      id: session.userId,
      isActive: true,
      sessionVersion: session.sessionVersion,
    },
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

/** Quyền tài chính tách biệt với quyền tạo và sở hữu dự án. */
export async function requireRevenueViewer() {
  const user = await requireUser();
  if (!canViewRevenue(user.role)) redirect("/");
  return user;
}

/** Kiểm tra user là thành viên của project, trả về membership hoặc null */
export async function getMembership(projectId: string, userId: string) {
  return prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
}
