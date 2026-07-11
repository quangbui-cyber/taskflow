"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export type CatalogState = { error?: string; success?: string };

export async function createClient(
  _prev: CatalogState,
  formData: FormData
): Promise<CatalogState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Tên client không được để trống." };

  const existing = await prisma.client.findUnique({ where: { name } });
  if (existing) return { error: "Client này đã tồn tại." };

  await prisma.client.create({ data: { name } });
  revalidatePath("/admin/catalog");
  return { success: `Đã thêm client "${name}".` };
}

export async function deleteClient(id: string) {
  await requireAdmin();
  // onDelete: SetNull ở Project.clientId → project cũ chỉ mất tham chiếu, không bị xoá
  await prisma.client.delete({ where: { id } });
  revalidatePath("/admin/catalog");
}

export async function createAccount(
  _prev: CatalogState,
  formData: FormData
): Promise<CatalogState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const teamId = String(formData.get("teamId") ?? "") || null;
  if (!name) return { error: "Tên account không được để trống." };

  const existing = await prisma.account.findUnique({ where: { name } });
  if (existing) return { error: "Account này đã tồn tại." };

  if (teamId) {
    const team = await prisma.salesTeam.findUnique({ where: { id: teamId } });
    if (!team) return { error: "Team kinh doanh không tồn tại." };
  }

  await prisma.account.create({ data: { name, teamId } });
  revalidatePath("/admin/catalog");
  revalidatePath("/revenue");
  return { success: `Đã thêm account "${name}".` };
}

export async function deleteAccount(id: string) {
  await requireAdmin();
  await prisma.account.delete({ where: { id } });
  revalidatePath("/admin/catalog");
  revalidatePath("/revenue");
}

export async function setAccountTeam(
  accountId: string,
  teamId: string | null
): Promise<CatalogState> {
  await requireAdmin();

  if (teamId) {
    const team = await prisma.salesTeam.findUnique({ where: { id: teamId } });
    if (!team) return { error: "Team kinh doanh không tồn tại." };
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { error: "Account không tồn tại." };

  await prisma.account.update({
    where: { id: accountId },
    data: { teamId },
  });
  revalidatePath("/admin/catalog");
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
  revalidatePath("/admin/catalog");
  return { success: `Đã thêm team "${name}".` };
}

export async function deleteSalesTeam(id: string) {
  await requireAdmin();
  await prisma.salesTeam.delete({ where: { id } });
  revalidatePath("/admin/catalog");
  revalidatePath("/revenue");
}
