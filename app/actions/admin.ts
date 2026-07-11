"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export type AdminState = { error?: string; success?: string };

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

  if (!name || !email || !password) {
    return { error: "Vui lòng điền đầy đủ thông tin." };
  }
  if (password.length < 6) {
    return { error: "Mật khẩu phải có ít nhất 6 ký tự." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Email này đã tồn tại." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { name, email, passwordHash, role } });

  revalidatePath("/admin");
  return { success: `Đã tạo tài khoản cho ${name}.` };
}

export async function deleteUser(userId: string): Promise<AdminState> {
  const admin = await requireAdmin();
  if (userId === admin.id) return { error: "Không thể tự xoá chính mình." };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      _count: { select: { ownedProjects: true, createdTasks: true } },
    },
  });
  if (!user) return { error: "Tài khoản không tồn tại." };
  if (user._count.ownedProjects > 0) {
    return {
      error:
        "Không thể xoá tài khoản đang là chủ project. Hãy chuyển hoặc xoá các project đó trước.",
    };
  }
  if (user._count.createdTasks > 0) {
    return {
      error:
        "Không thể xoá tài khoản đã tạo task vì sẽ làm mất dữ liệu công việc. Hãy giữ tài khoản hoặc bổ sung luồng chuyển dữ liệu trước.",
    };
  }

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin");
  return { success: "Đã xoá tài khoản." };
}

/** Gán quản lý trực tiếp cho một nhân viên (managerId = null để bỏ gán) */
export async function setManager(userId: string, managerId: string | null) {
  await requireAdmin();
  if (managerId === userId) return; // không tự quản lý chính mình

  if (managerId) {
    // Chống vòng lặp: đi ngược chuỗi quản lý từ managerId, không được gặp lại userId
    let current: string | null = managerId;
    while (current) {
      if (current === userId) return; // sẽ tạo vòng lặp — từ chối
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
}

export async function resetPassword(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 6) {
    return { error: "Mật khẩu mới phải có ít nhất 6 ký tự." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  revalidatePath("/admin");
  return { success: "Đã đổi mật khẩu." };
}
