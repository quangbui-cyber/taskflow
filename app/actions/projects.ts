"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageProjects, getMembership, requireUser } from "@/lib/auth";
import {
  sendGoogleChat,
  validateGoogleChatWebhookUrl,
} from "@/lib/googleChat";
import { readProjectUpload } from "@/lib/projectFiles";
import { projectStatusColor } from "@/lib/types";

export type ActionState = { error?: string; success?: string };

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

async function findValidAccount(accountId: string | null) {
  if (!accountId) return null;
  return prisma.account.findFirst({
    where: {
      id: accountId,
      user: { isActive: true },
    },
    select: { id: true, userId: true },
  });
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
  const projectSource = String(formData.get("projectSource") ?? "");
  let projectFile: Awaited<ReturnType<typeof readProjectUpload>> = null;

  if (!name) return { error: "Tên project không được để trống." };
  if (revenue === null) return { error: "Doanh thu không hợp lệ." };
  try {
    projectFile = await readProjectUpload(formData.get("projectFile"));
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Tài liệu PO không hợp lệ.",
    };
  }
  const account = await findValidAccount(accountId);
  if (accountId && !account) {
    return { error: "Account chưa liên kết user hoặc chưa được gán Team." };
  }
  const initialMembers = [{ userId: user.id, role: "owner" }];
  if (account?.userId && account.userId !== user.id) {
    initialMembers.push({ userId: account.userId, role: "member" });
  }
  const initialStatus =
    projectSource === "JABIL_PO" && projectFile?.mimeType === "application/pdf"
      ? "ON_PROCESS"
      : "BIDDING";
  const project = await prisma.project.create({
    data: {
      name,
      description: description || null,
      color: projectStatusColor(initialStatus),
      status: initialStatus,
      revenue,
      clientId,
      accountId,
      ownerId: user.id,
      members: { create: initialMembers },
      files: projectFile
        ? {
            create: {
              uploaderId: user.id,
              name: projectFile.name,
              mimeType: projectFile.mimeType,
              size: projectFile.size,
              data: projectFile.data,
            },
          }
        : undefined,
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
  if (
    accountId !== project.accountId &&
    accountId &&
    !(await findValidAccount(accountId))
  ) {
    return { error: "Account chưa liên kết user hoặc chưa được gán Team." };
  }
  await prisma.project.update({
    where: { id: projectId },
    data: {
      name,
      description: description || null,
      revenue,
      clientId,
      accountId,
    },
  });

  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  return {};
}

/** Đổi nhanh trạng thái project từ thanh thông tin đầu trang. */
export async function updateProjectStatus(
  projectId: string,
  status: string
): Promise<ActionState> {
  const user = await requireUser();
  if (!PROJECT_STATUS_KEYS.includes(status)) {
    return { error: "Tình trạng không hợp lệ." };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, status: true, completedAt: true },
  });
  if (!project) return { error: "Project không tồn tại." };
  if (project.ownerId !== user.id && user.role !== "ADMIN") {
    return { error: "Chỉ chủ project hoặc admin mới được đổi trạng thái." };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      status,
      color: projectStatusColor(status),
      completedAt:
        status === "DONE"
          ? project.status === "DONE"
            ? (project.completedAt ?? new Date())
            : new Date()
          : null,
    },
  });

  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/revenue");
  revalidatePath("/team");
  return { success: "Đã cập nhật trạng thái dự án." };
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

async function manageableProject(projectId: string) {
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      googleChatWebhookUrl: true,
    },
  });

  if (!project) return { error: "Project không tồn tại." } as const;
  if (project.ownerId !== user.id && user.role !== "ADMIN") {
    return {
      error: "Chỉ chủ project hoặc admin được cấu hình Google Chat.",
    } as const;
  }
  return { project } as const;
}

export async function saveProjectGoogleChatWebhook(
  projectId: string,
  webhookUrl: string
) {
  const access = await manageableProject(projectId);
  if ("error" in access) return access;

  const normalizedUrl = webhookUrl.trim();
  if (!validateGoogleChatWebhookUrl(normalizedUrl)) {
    return {
      error: "URL không đúng định dạng webhook của Google Chat.",
    };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { googleChatWebhookUrl: normalizedUrl },
  });

  revalidatePath(`/projects/${projectId}`);
  return { success: "Đã kết nối dự án với Google Chat." };
}

export async function testProjectGoogleChatWebhook(projectId: string) {
  const access = await manageableProject(projectId);
  if ("error" in access) return access;
  if (!access.project.googleChatWebhookUrl) {
    return { error: "Dự án chưa có webhook Google Chat." };
  }

  const result = await sendGoogleChat(
    access.project.googleChatWebhookUrl,
    `*${access.project.name}*\nKết nối Google Chat thành công.`
  );
  if (!result.ok) return { error: result.error };
  return { success: "Đã gửi tin thử vào Google Chat." };
}

export async function disconnectProjectGoogleChatWebhook(projectId: string) {
  const access = await manageableProject(projectId);
  if ("error" in access) return access;

  await prisma.project.update({
    where: { id: projectId },
    data: { googleChatWebhookUrl: null },
  });
  revalidatePath(`/projects/${projectId}`);
  return { success: "Đã ngắt kết nối Google Chat." };
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
  if (!invitee.isActive) {
    return { error: "Tài khoản này đã bị vô hiệu hóa và không thể thêm vào dự án." };
  }

  const existing = await getMembership(projectId, invitee.id);
  if (existing) return { error: "Người này đã là thành viên." };

  await prisma.projectMember.create({
    data: { projectId, userId: invitee.id, role: "member" },
  });

  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function addMemberGroup(
  projectId: string,
  groupId: string
): Promise<ActionState> {
  const user = await requireUser();
  const membership = await getMembership(projectId, user.id);
  if (!membership) return { error: "Bạn không thuộc project này." };

  const group = await prisma.memberGroup.findUnique({
    where: { id: groupId },
    select: {
      name: true,
      members: {
        where: { user: { isActive: true } },
        select: { userId: true },
      },
    },
  });
  if (!group) return { error: "Nhóm không tồn tại." };
  if (group.members.length === 0) return { error: "Nhóm chưa có thành viên." };

  const memberIds = group.members.map((member) => member.userId);
  const existingMembers = await prisma.projectMember.findMany({
    where: { projectId, userId: { in: memberIds } },
    select: { userId: true },
  });
  const existingIds = new Set(existingMembers.map((member) => member.userId));
  const newMemberIds = memberIds.filter((userId) => !existingIds.has(userId));

  if (newMemberIds.length === 0) {
    return { error: `Tất cả thành viên nhóm "${group.name}" đã có trong project.` };
  }

  await prisma.projectMember.createMany({
    data: newMemberIds.map((userId) => ({
      projectId,
      userId,
      role: "member",
    })),
    skipDuplicates: true,
  });

  revalidatePath(`/projects/${projectId}`);
  return {
    success: `Đã thêm ${newMemberIds.length} người từ nhóm "${group.name}".`,
  };
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
