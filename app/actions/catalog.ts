"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/auth";
import {
  canCreateClient,
  clientNameError,
  clientNameKey,
  normalizeClientName,
} from "@/lib/clientCatalog";

export type CatalogState = { error?: string; success?: string };
export type QuickClientState = CatalogState & {
  client?: { id: string; name: string };
};

const ACCOUNT_ELIGIBLE_ROLES = ["ADMIN", "ACCOUNT"];

async function findClientByName(name: string, excludeId?: string) {
  const key = clientNameKey(name);
  const clients = await prisma.client.findMany({
    select: { id: true, name: true },
  });
  return clients.find((client) => client.id !== excludeId && clientNameKey(client.name) === key) ?? null;
}

async function insertClient(name: string) {
  try {
    const client = await prisma.client.create({
      data: { name },
      select: { id: true, name: true },
    });
    return { client, created: true };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { client: await findClientByName(name), created: false };
    }
    throw error;
  }
}

export async function createClient(
  _prev: CatalogState,
  formData: FormData
): Promise<CatalogState> {
  await requireAdmin();
  const name = normalizeClientName(String(formData.get("name") ?? ""));
  const validationError = clientNameError(name);
  if (validationError) return { error: validationError };

  const existing = await findClientByName(name);
  if (existing) return { error: "Client này đã tồn tại." };

  const result = await insertClient(name);
  if (!result.client || !result.created) return { error: "Client này đã tồn tại." };
  revalidatePath("/admin");
  revalidatePath("/projects/new");
  return { success: `Đã thêm client "${name}".` };
}

export async function createProjectClient(
  rawName: string,
): Promise<QuickClientState> {
  const user = await requireUser();
  if (!canCreateClient(user.role)) {
    return { error: "Chỉ Admin hoặc Account được tạo Client mới." };
  }

  const name = normalizeClientName(rawName);
  const validationError = clientNameError(name);
  if (validationError) return { error: validationError };

  const existing = await findClientByName(name);
  if (existing) {
    return {
      success: `Client "${existing.name}" đã tồn tại và đã được chọn.`,
      client: existing,
    };
  }

  const result = await insertClient(name);
  if (!result.client) {
    const concurrentClient = await findClientByName(name);
    if (concurrentClient) {
      return {
        success: `Client "${concurrentClient.name}" đã tồn tại và đã được chọn.`,
        client: concurrentClient,
      };
    }
    return { error: "Không thể tạo Client lúc này. Vui lòng thử lại." };
  }

  if (!result.created) {
    return {
      success: `Client "${result.client.name}" đã tồn tại và đã được chọn.`,
      client: result.client,
    };
  }

  revalidatePath("/admin");
  revalidatePath("/projects/new");
  return {
    success: `Đã tạo Client "${result.client.name}".`,
    client: result.client,
  };
}

export async function updateClient(
  id: string,
  name: string
): Promise<CatalogState> {
  await requireAdmin();
  const normalizedName = normalizeClientName(name);
  const validationError = clientNameError(normalizedName);
  if (validationError) return { error: validationError };

  const duplicate = await findClientByName(normalizedName, id);
  if (duplicate) return { error: "Client này đã tồn tại." };

  try {
    await prisma.client.update({
      where: { id },
      data: { name: normalizedName },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: "Client này đã tồn tại." };
    }
    throw error;
  }
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

  await prisma.$transaction([
    // Trưởng team phải thuộc team mình dẫn dắt: rời team thì thôi làm trưởng.
    prisma.salesTeam.updateMany({
      where: { leaderId: accountId, id: { not: teamId } },
      data: { leaderId: null },
    }),
    prisma.account.update({
      where: { id: accountId },
      data: { teamId },
    }),
  ]);
  revalidatePath("/", "layout");
  revalidatePath("/admin");
  revalidatePath("/revenue");
  revalidatePath("/kpi");
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

export async function renameSalesTeam(
  id: string,
  rawName: string
): Promise<CatalogState> {
  await requireAdmin();
  const name = rawName.trim();
  if (!name) return { error: "Tên team không được để trống." };

  const duplicate = await prisma.salesTeam.findFirst({
    where: { name, id: { not: id } },
    select: { id: true },
  });
  if (duplicate) return { error: "Team này đã tồn tại." };

  const updated = await prisma.salesTeam.updateMany({
    where: { id },
    data: { name },
  });
  if (updated.count === 0) return { error: "Team không tồn tại." };
  // Tên team hiện ở sidebar, Doanh số và KPI.
  revalidatePath("/", "layout");
  return { success: `Đã đổi tên team thành "${name}".` };
}

/** Trưởng team (manager): Account được chia KPI của team xuống từng Account. */
export async function setSalesTeamLeader(
  teamId: string,
  accountId: string
): Promise<CatalogState> {
  await requireAdmin();
  const team = await prisma.salesTeam.findUnique({
    where: { id: teamId },
    select: { name: true, accounts: { select: { id: true, name: true } } },
  });
  if (!team) return { error: "Team không tồn tại." };

  const leader = accountId
    ? team.accounts.find((account) => account.id === accountId)
    : null;
  if (accountId && !leader) {
    return { error: "Manager phải là Account thuộc team đó." };
  }

  await prisma.salesTeam.update({
    where: { id: teamId },
    data: { leaderId: leader?.id ?? null },
  });
  revalidatePath("/admin");
  revalidatePath("/kpi");
  return {
    success: leader
      ? `${leader.name} là Manager của ${team.name}.`
      : `Đã bỏ Manager của ${team.name}.`,
  };
}
