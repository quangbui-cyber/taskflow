"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export type CatalogState = { error?: string; success?: string };

const ACCOUNT_ELIGIBLE_ROLES = ["ADMIN", "ACCOUNT"];

export async function createClient(
  _prev: CatalogState,
  formData: FormData
): Promise<CatalogState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Tên client không được để trống." };

  const existing = await prisma.client.findUnique({ where: { name } });
  if (existing) return { error: "Client này đã tồn tại." };

  await prisma.client.create({
    data: { name },
  });
  revalidatePath("/admin");
  return { success: `Đã thêm client "${name}".` };
}

export async function updateClient(
  id: string,
  name: string
): Promise<CatalogState> {
  await requireAdmin();
  const normalizedName = name.trim();
  if (!normalizedName) return { error: "Tên client không được để trống." };

  const duplicate = await prisma.client.findFirst({
    where: { name: normalizedName, id: { not: id } },
    select: { id: true },
  });
  if (duplicate) return { error: "Client này đã tồn tại." };

  await prisma.client.update({
    where: { id },
    data: { name: normalizedName },
  });
  revalidatePath("/admin");
  revalidatePath("/projects/new");
  revalidatePath("/projects/[id]", "page");
  return { success: `Đã cập nhật client "${normalizedName}".` };
}

export async function deleteClient(id: string): Promise<CatalogState> {
  await requireAdmin();
  // onDelete: SetNull ở Project.clientId → project cũ chỉ mất tham chiếu, không bị xoá
  await prisma.client.delete({ where: { id } });
  revalidatePath("/admin");
  revalidatePath("/projects/new");
  return { success: "Đã xoá Client." };
}

export async function createAccount(
  _prev: CatalogState,
  formData: FormData
): Promise<CatalogState> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  if (!userId) return { error: "Vui lòng chọn tài khoản Account." };
  if (!teamId) return { error: "Account bắt buộc phải thuộc một Team." };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      isActive: true,
      accountProfile: { select: { id: true } },
    },
  });
  if (!user || !ACCOUNT_ELIGIBLE_ROLES.includes(user.role)) {
    return { error: "Chỉ người dùng có vai trò Admin hoặc Account mới được chọn." };
  }
  if (!user.isActive) return { error: "Tài khoản này đã bị vô hiệu hóa." };
  if (user.accountProfile) return { error: "Tài khoản này đã có trong danh sách Account." };

  const team = await prisma.salesTeam.findUnique({ where: { id: teamId } });
  if (!team) return { error: "Team kinh doanh không tồn tại." };

  await prisma.account.create({ data: { name: user.name, userId, teamId } });
  revalidatePath("/admin");
  revalidatePath("/projects/new");
  revalidatePath("/revenue");
  return { success: `Đã thêm account "${user.name}".` };
}

export async function linkLegacyAccount(
  accountId: string,
  userId: string,
  teamId: string
): Promise<CatalogState> {
  await requireAdmin();
  if (!userId) return { error: "Vui lòng chọn tài khoản Account." };
  if (!teamId) return { error: "Account bắt buộc phải thuộc một Team." };

  const [account, user, team] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        role: true,
        isActive: true,
        accountProfile: { select: { id: true } },
      },
    }),
    prisma.salesTeam.findUnique({ where: { id: teamId } }),
  ]);
  if (!account) return { error: "Account cũ không tồn tại." };
  if (account.userId) return { error: "Account này đã được liên kết." };
  if (!user || !ACCOUNT_ELIGIBLE_ROLES.includes(user.role)) {
    return { error: "Chỉ người dùng có vai trò Admin hoặc Account mới được chọn." };
  }
  if (!user.isActive) return { error: "Tài khoản này đã bị vô hiệu hóa." };
  if (user.accountProfile) return { error: "Tài khoản này đã liên kết với Account khác." };
  if (!team) return { error: "Team kinh doanh không tồn tại." };

  await prisma.account.update({
    where: { id: accountId },
    data: { name: user.name, userId, teamId },
  });
  revalidatePath("/admin");
  revalidatePath("/projects/new");
  revalidatePath("/revenue");
  return { success: `Đã liên kết dữ liệu cũ với ${user.name}.` };
}

export async function deleteAccount(id: string): Promise<CatalogState> {
  await requireAdmin();

  const account = await prisma.account.findUnique({
    where: { id },
    select: { name: true, _count: { select: { projects: true } } },
  });
  if (!account) return { error: "Account không tồn tại." };
  if (account._count.projects > 0) {
    return {
      error: `Không thể xoá "${account.name}" vì đang gắn ${account._count.projects} project.`,
    };
  }

  await prisma.account.delete({ where: { id } });
  revalidatePath("/admin");
  revalidatePath("/projects/new");
  revalidatePath("/revenue");
  return { success: `Đã xoá Account "${account.name}".` };
}

export async function setAccountTeam(
  accountId: string,
  teamId: string
): Promise<CatalogState> {
  await requireAdmin();

  if (!teamId) return { error: "Account bắt buộc phải thuộc một Team." };
  const team = await prisma.salesTeam.findUnique({ where: { id: teamId } });
  if (!team) return { error: "Team kinh doanh không tồn tại." };

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { error: "Account không tồn tại." };

  await prisma.account.update({
    where: { id: accountId },
    data: { teamId },
  });
  revalidatePath("/", "layout");
  revalidatePath("/revenue");
  return {};
}

export async function createSalesTeam(
  _prev: CatalogState,
  formData: FormData
): Promise<CatalogState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Tên team không được để trống." };

  const existing = await prisma.salesTeam.findUnique({ where: { name } });
  if (existing) return { error: "Team này đã tồn tại." };

  await prisma.salesTeam.create({ data: { name } });
  revalidatePath("/", "layout");
  return { success: `Đã thêm team "${name}".` };
}

export async function deleteSalesTeam(id: string): Promise<CatalogState> {
  await requireAdmin();
  const team = await prisma.salesTeam.findUnique({
    where: { id },
    select: { name: true, _count: { select: { accounts: true } } },
  });
  if (!team) return { error: "Team không tồn tại." };
  if (team._count.accounts > 0) {
    return {
      error: `Không thể xoá "${team.name}" vì đang có ${team._count.accounts} Account.`,
    };
  }
  await prisma.salesTeam.delete({ where: { id } });
  revalidatePath("/", "layout");
  revalidatePath("/revenue");
  return { success: `Đã xoá Team "${team.name}".` };
}
