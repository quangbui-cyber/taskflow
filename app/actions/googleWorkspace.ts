"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clearGoogleConnection, revokeGoogleToken } from "@/lib/googleWorkspace";

export type GoogleWorkspaceActionState = { error?: string; success?: string };

/** Ngắt kết nối Google: xoá khoá trong app và thu hồi quyền ở phía Google. */
export async function disconnectGoogleWorkspace(): Promise<GoogleWorkspaceActionState> {
  const user = await requireUser();
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { googleToken: true } });
  await clearGoogleConnection(user.id);
  if (row?.googleToken) await revokeGoogleToken(row.googleToken);
  revalidatePath("/profile");
  return { success: "Đã ngắt kết nối Google. Email duyệt sẽ gửi bằng hộp thư chung của app." };
}
