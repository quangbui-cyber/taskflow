"use server";

import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { parseAvatarDataUrl } from "@/lib/avatarImage";
import { passwordLengthError } from "@/lib/password";
import { OPEN_PROJECT_STATUSES } from "@/lib/types";

export type AdminState = { error?: string; success?: string };

const USER_ROLES = ["ADMIN", "ACCOUNT", "USER"] as const;

export async function createUser(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const rawRole = String(formData.get("role") ?? "USER");
  const role = ["ADMIN", "ACCOUNT"].includes(rawRole) ? rawRole : "USER";
  const avatar = parseAvatarDataUrl(formData.get("avatarUrl"));

  if (!name || !email || !password) {
    return { error: "Vui lòng điền đầy đủ thông tin." };
  }
  const passwordError = passwordLengthError(password);
  if (passwordError) return { error: passwordError };
  if (avatar.error) return { error: avatar.error };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Email này đã tồn tại." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { name, email, passwordHash, role, avatarUrl: avatar.avatarUrl },
  });

  revalidatePath("/admin");
  return { success: `Đã tạo tài khoản cho ${name}.` };
}

export async function deleteUser(
  userId: string,
  recipientId?: string | null
): Promise<AdminState> {
  const admin = await requireAdmin();
  if (userId === admin.id) return { error: "Không thể tự xoá chính mình." };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      isActive: true,
      deletedAt: true,
      accountProfile: { select: { id: true } },
    },
  });
  if (!user || user.deletedAt) return { error: "Tài khoản không tồn tại." };
  if (user.isActive) {
    return { error: "Hãy vô hiệu hóa tài khoản trước khi xoá vĩnh viễn." };
  }
  if (user.accountProfile) {
    return {
      error:
        "Không thể xoá user đang được dùng làm Account. Hãy xoá Account trong Cài đặt trước.",
    };
  }

  // Dự án đang chạy và task chưa xong phải có người nhận. Dự án đã đóng,
  // task đã xong và bình luận vẫn giữ tên người này để làm lịch sử.
  const openProject = { status: { in: OPEN_PROJECT_STATUSES } };
  const [ownedProjects, openTasks] = await Promise.all([
    prisma.project.findMany({
      where: { ownerId: userId, ...openProject },
      select: { id: true },
    }),
    prisma.task.findMany({
      where: { assigneeId: userId, status: { not: "DONE" }, project: openProject },
      select: { id: true, projectId: true },
    }),
  ]);
  const ownedProjectIds = ownedProjects.map((project) => project.id);
  const openTaskIds = openTasks.map((task) => task.id);
  const handoverProjectIds = [
    ...new Set([...ownedProjectIds, ...openTasks.map((task) => task.projectId)]),
  ];

  let recipient: { id: string; name: string } | null = null;
  if (handoverProjectIds.length > 0) {
    if (!recipientId) {
      return { error: "Hãy chọn người nhận bàn giao dự án và task đang chạy." };
    }
    if (recipientId === userId) {
      return { error: "Người nhận bàn giao phải là một tài khoản khác." };
    }
    recipient = await prisma.user.findFirst({
      where: { id: recipientId, isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!recipient) {
      return { error: "Người nhận bàn giao không tồn tại hoặc đã bị vô hiệu hóa." };
    }
  }

  // Mật khẩu ngẫu nhiên không ai biết, để tài khoản không thể đăng nhập lại.
  const lockedPasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);

  await prisma.$transaction(async (tx) => {
    if (recipient) {
      for (const projectId of handoverProjectIds) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId, userId: recipient.id } },
          create: { projectId, userId: recipient.id },
          update: {},
        });
      }
      if (ownedProjectIds.length > 0) {
        await tx.project.updateMany({
          where: { id: { in: ownedProjectIds } },
          data: { ownerId: recipient.id },
        });
        await tx.projectMember.updateMany({
          where: { projectId: { in: ownedProjectIds }, userId: recipient.id },
          data: { role: "owner" },
        });
      }
      if (openTaskIds.length > 0) {
        await tx.task.updateMany({
          where: { id: { in: openTaskIds } },
          data: { assigneeId: recipient.id },
        });
      }
    }

    // Rời các dự án đang chạy; dự án đã đóng giữ lại để còn ghi nhận. Dự án đang
    // chạy mà người này vẫn còn task (đã xong) thì giữ họ làm thành viên thường,
    // vì bảng task tìm người làm trong danh sách thành viên và việc sửa task đòi
    // người làm phải là thành viên.
    await tx.projectMember.deleteMany({
      where: {
        userId,
        project: { ...openProject, tasks: { none: { assigneeId: userId } } },
      },
    });
    await tx.projectMember.updateMany({
      where: { userId, project: openProject },
      data: { role: "member" },
    });
    await tx.taskFollower.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.pushSubscription.deleteMany({ where: { userId } });
    await tx.memberGroupMember.deleteMany({ where: { userId } });
    await tx.user.updateMany({
      where: { managerId: userId },
      data: { managerId: null },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        isActive: false,
        // Giải phóng email để có thể tạo lại tài khoản mới với email này.
        email: `deleted-${userId}@deleted.invalid`,
        // Giải phóng tài khoản Google để tài khoản mới cùng email liên kết lại được.
        googleSub: null,
        googleMeetToken: null,
        passwordHash: lockedPasswordHash,
        sessionVersion: { increment: 1 },
        managerId: null,
        isLeaveManager: false,
      },
    });
  });

  revalidatePath("/", "layout");
  if (!recipient) return { success: `Đã xoá tài khoản ${user.name}.` };
  const handedOver = [
    ownedProjectIds.length > 0 ? `${ownedProjectIds.length} dự án` : null,
    openTaskIds.length > 0 ? `${openTaskIds.length} task` : null,
  ]
    .filter(Boolean)
    .join(" và ");
  return {
    success: `Đã xoá tài khoản ${user.name} và bàn giao ${handedOver} cho ${recipient.name}.`,
  };
}

export async function setUserActive(
  userId: string,
  isActive: boolean
): Promise<AdminState> {
  const admin = await requireAdmin();
  if (userId === admin.id && !isActive) {
    return { error: "Bạn không thể tự vô hiệu hóa tài khoản của chính mình." };
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, isActive: true, deletedAt: true },
  });
  if (!target || target.deletedAt) return { error: "Tài khoản không tồn tại." };
  if (target.isActive === isActive) {
    return {
      success: isActive
        ? "Tài khoản đang hoạt động."
        : "Tài khoản đã được vô hiệu hóa.",
    };
  }

  if (!isActive && target.role === "ADMIN") {
    const activeAdminCount = await prisma.user.count({
      where: { role: "ADMIN", isActive: true },
    });
    if (activeAdminCount <= 1) {
      return { error: "Hệ thống phải luôn có ít nhất một Admin đang hoạt động." };
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      isActive,
      deactivatedAt: isActive ? null : new Date(),
      // Vô hiệu hóa phải thu hồi hẳn cookie cũ; nếu kích hoạt lại thì các phiên
      // trước đó vẫn không thể tự sống lại.
      ...(!isActive ? { sessionVersion: { increment: 1 } } : {}),
    },
  });

  revalidatePath("/", "layout");
  return {
    success: isActive
      ? `Đã kích hoạt lại tài khoản ${target.name}.`
      : `Đã vô hiệu hóa tài khoản ${target.name}.`,
  };
}

export async function updateUserProfile(
  userId: string,
  name: string,
  role: string,
  rawAvatarUrl: string
): Promise<AdminState> {
  const admin = await requireAdmin();
  const normalizedName = name.trim();
  const avatar = parseAvatarDataUrl(rawAvatarUrl);

  if (!normalizedName) return { error: "Tên tài khoản không được để trống." };
  if (avatar.error) return { error: avatar.error };
  if (!USER_ROLES.includes(role as (typeof USER_ROLES)[number])) {
    return { error: "Vai trò tài khoản không hợp lệ." };
  }
  const normalizedRole = role as (typeof USER_ROLES)[number];

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      accountProfile: { select: { id: true } },
    },
  });
  if (!target) return { error: "Tài khoản không tồn tại." };

  if (target.role === "ADMIN" && normalizedRole !== "ADMIN") {
    if (target.id === admin.id) {
      return { error: "Bạn không thể tự bỏ vai trò Admin của chính mình." };
    }
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      return { error: "Hệ thống phải luôn có ít nhất một Admin." };
    }
  }

  if (normalizedRole === "USER" && target.accountProfile) {
    return {
      error: "Tài khoản đang được dùng làm Account. Hãy xoá liên kết Account trước khi chuyển thành User.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        name: normalizedName,
        role: normalizedRole,
        avatarUrl: avatar.avatarUrl,
      },
    });
    if (target.accountProfile) {
      await tx.account.update({
        where: { id: target.accountProfile.id },
        data: { name: normalizedName },
      });
    }
  });

  revalidatePath("/", "layout");
  return { success: "Đã cập nhật thông tin tài khoản." };
}

/** Gán quản lý trực tiếp cho một nhân viên (managerId = null để bỏ gán) */
export async function setManager(
  userId: string,
  managerId: string | null
): Promise<AdminState> {
  await requireAdmin();
  if (managerId === userId) {
    return { error: "Một tài khoản không thể tự quản lý chính mình." };
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!targetUser) return { error: "Tài khoản không tồn tại." };

  if (managerId) {
    const manager = await prisma.user.findUnique({
      where: { id: managerId },
      select: { id: true, isActive: true },
    });
    if (!manager) return { error: "Người quản lý không tồn tại." };
    if (!manager.isActive) return { error: "Không thể chọn tài khoản đã bị vô hiệu hóa làm quản lý." };

    // Chống vòng lặp: đi ngược chuỗi quản lý từ managerId, không được gặp lại userId
    let current: string | null = managerId;
    while (current) {
      if (current === userId) {
        return { error: "Không thể lưu vì quan hệ quản lý sẽ tạo thành vòng lặp." };
      }
      const u: { managerId: string | null } | null =
        await prisma.user.findUnique({
          where: { id: current },
          select: { managerId: true },
        });
      current = u?.managerId ?? null;
    }
  }

  await prisma.user.update({ where: { id: userId }, data: { managerId } });
  revalidatePath("/admin");
  revalidatePath("/team");
  return { success: "Đã lưu thay đổi người quản lý." };
}

export async function resetPassword(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  const passwordError = passwordLengthError(password);
  if (passwordError) return { error: passwordError };

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      // Mọi JWT đã cấp chứa version cũ và sẽ bị từ chối ở request kế tiếp.
      sessionVersion: { increment: 1 },
    },
  });

  revalidatePath("/admin");
  return { success: "Đã đổi mật khẩu." };
}

function memberIdsFromForm(formData: FormData) {
  return [...new Set(formData.getAll("memberIds").map(String).filter(Boolean))];
}

async function validMemberIds(memberIds: string[]) {
  if (memberIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: memberIds }, isActive: true },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

export async function createMemberGroup(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const memberIds = memberIdsFromForm(formData);
  if (!name) return { error: "Tên nhóm không được để trống." };
  if (memberIds.length === 0) return { error: "Nhóm cần có ít nhất một thành viên." };

  const existing = await prisma.memberGroup.findUnique({ where: { name } });
  if (existing) return { error: "Tên nhóm này đã tồn tại." };
  const validIds = await validMemberIds(memberIds);
  if (validIds.length !== memberIds.length) {
    return { error: "Danh sách thành viên có tài khoản không hợp lệ." };
  }

  await prisma.memberGroup.create({
    data: {
      name,
      members: { create: validIds.map((userId) => ({ userId })) },
    },
  });
  revalidatePath("/", "layout");
  return { success: `Đã tạo nhóm "${name}".` };
}

export async function updateMemberGroup(
  groupId: string,
  name: string,
  memberIds: string[]
): Promise<AdminState> {
  await requireAdmin();
  const normalizedName = name.trim();
  const uniqueMemberIds = [...new Set(memberIds.filter(Boolean))];
  if (!normalizedName) return { error: "Tên nhóm không được để trống." };
  if (uniqueMemberIds.length === 0) {
    return { error: "Nhóm cần có ít nhất một thành viên." };
  }

  const [group, duplicate, validIds] = await Promise.all([
    prisma.memberGroup.findUnique({ where: { id: groupId }, select: { id: true } }),
    prisma.memberGroup.findFirst({
      where: { name: normalizedName, id: { not: groupId } },
      select: { id: true },
    }),
    validMemberIds(uniqueMemberIds),
  ]);
  if (!group) return { error: "Nhóm không tồn tại." };
  if (duplicate) return { error: "Tên nhóm này đã tồn tại." };
  if (validIds.length !== uniqueMemberIds.length) {
    return { error: "Danh sách thành viên có tài khoản không hợp lệ." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.memberGroup.update({
      where: { id: groupId },
      data: { name: normalizedName },
    });
    await tx.memberGroupMember.deleteMany({ where: { groupId } });
    await tx.memberGroupMember.createMany({
      data: validIds.map((userId) => ({ groupId, userId })),
    });
  });
  revalidatePath("/", "layout");
  return { success: `Đã cập nhật nhóm "${normalizedName}".` };
}

export async function deleteMemberGroup(groupId: string): Promise<AdminState> {
  await requireAdmin();
  const group = await prisma.memberGroup.findUnique({
    where: { id: groupId },
    select: { name: true },
  });
  if (!group) return { error: "Nhóm không tồn tại." };

  await prisma.memberGroup.delete({ where: { id: groupId } });
  revalidatePath("/", "layout");
  return { success: `Đã xoá nhóm "${group.name}".` };
}
