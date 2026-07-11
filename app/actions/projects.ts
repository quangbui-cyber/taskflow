"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageProjects, getMembership, requireUser } from "@/lib/auth";

export type ActionState = { error?: string };

const PROJECT_COLORS = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#8b5cf6",
  "#ef4444",
];

const PROJECT_STATUS_KEYS = [
  "BIDDING",
  "ON_PROCESS",
  "PENDING",
  "DONE",
  "CANCEL",
  "FAIL",
];

function parseRevenue(raw: string): number | null {
  // Chấp nhận "500000000", "500.000.000", "500,000,000"
  const cleaned = raw.replace(/[.,\s₫đ]/gi, "");
  if (cleaned === "") return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export async function createProject(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!canManageProjects(user.role)) {
    return { error: "Bạn không có quyền tạo project. Liên hệ Admin hoặc Account." };
  }
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const revenue = parseRevenue(String(formData.get("revenue") ?? ""));
  const clientId = String(formData.get("clientId") ?? "") || null;
  const accountId = String(formData.get("accountId") ?? "") || null;

  if (!name) return { error: "Tên project không được để trống." };
  if (revenue === null) return { error: "Doanh thu không hợp lệ." };
  const color =
    PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];

  const project = await prisma.project.create({
    data: {
      name,
      description: description || null,
      color,
      status: "BIDDING",
      revenue,
      clientId,
      accountId,
      ownerId: user.id,
      members: { create: { userId: user.id, role: "owner" } },
    },
  });

  redirect(`/projects/${project.id}`);
}

/** Sửa thông tin chung của project — chỉ chủ project hoặc admin */
export async function updateProject(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  const revenue = parseRevenue(String(formData.get("revenue") ?? ""));
  const clientId = String(formData.get("clientId") ?? "") || null;
  const accountId = String(formData.get("accountId") ?? "") || null;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) return { error: "Project không tồn tại." };
  if (project.ownerId !== user.id && user.role !== "ADMIN") {
    return { error: "Chỉ chủ project hoặc admin mới được sửa." };
  }
  if (!name) return { error: "Tên project không được để trống." };
  if (revenue === null) return { error: "Doanh thu không hợp lệ." };
  if (!PROJECT_STATUS_KEYS.includes(status)) {
    return { error: "Tình trạng không hợp lệ." };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      name,
      description: description || null,
      status,
      revenue,
      clientId,
      accountId,
    },
  });

  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function deleteProject(projectId: string) {
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project || project.ownerId !== user.id) {
    return { error: "Chỉ chủ project mới được xoá." };
  }
  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/");
  redirect("/");
}

export async function addMember(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId") ?? "");
  const inviteeId = String(formData.get("inviteeId") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  const membership = await getMembership(projectId, user.id);
  if (!membership) return { error: "Bạn không thuộc project này." };

  const invitee = inviteeId
    ? await prisma.user.findUnique({ where: { id: inviteeId } })
    : await prisma.user.findUnique({ where: { email } });
  if (!invitee) {
    return {
      error:
        "Không tìm thấy người dùng này. Họ cần có tài khoản trước khi được thêm vào project.",
    };
  }

  const existing = await getMembership(projectId, invitee.id);
  if (existing) return { error: "Người này đã là thành viên." };

  await prisma.projectMember.create({
    data: { projectId, userId: invitee.id, role: "member" },
  });

  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function removeMember(projectId: string, memberUserId: string) {
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) return;
  // Chủ project được xoá người khác; thành viên được tự rời
  if (project.ownerId !== user.id && user.id !== memberUserId) return;
  if (memberUserId === project.ownerId) return; // không xoá được chủ project

  await prisma.$transaction(async (tx) => {
    const projectTasks = await tx.task.findMany({
      where: { projectId },
      select: { id: true },
    });
    const taskIds = projectTasks.map((task) => task.id);

    await tx.task.updateMany({
      where: { projectId, assigneeId: memberUserId },
      data: { assigneeId: null },
    });

    if (taskIds.length > 0) {
      await tx.taskFollower.deleteMany({
        where: { taskId: { in: taskIds }, userId: memberUserId },
      });
    }

    await tx.notification.deleteMany({
      where: { projectId, userId: memberUserId },
    });

    await tx.projectMember.deleteMany({
      where: { projectId, userId: memberUserId },
    });
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  revalidatePath("/team");
  revalidatePath("/notifications");
}
