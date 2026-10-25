"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { forgetDriveAccessToken } from "@/lib/googleDrive";
import { revokeGoogleToken } from "@/lib/googleWorkspace";
import { pendingDriveFileCounts, pushPendingFiles } from "@/lib/driveStorage";

export type DriveMigrationStep = {
  pushed: number;
  failed: number;
  pending: number;
  onDrive: number;
  error?: string;
};

/** Chuyển một đợt file cũ từ database lên Drive (giao diện gọi lặp lại tới khi hết). */
export async function migrateFilesToDrive(): Promise<DriveMigrationStep> {
  await requireAdmin();
  const result = await pushPendingFiles({ limit: 25, deadline: Date.now() + 40_000 });
  const counts = await pendingDriveFileCounts();
  revalidatePath("/admin");
  if (result.notConnected) {
    return { ...result, ...counts, error: "Google Drive chưa kết nối hoặc đã mất quyền. Kết nối lại rồi thử." };
  }
  return { pushed: result.pushed, failed: result.failed, ...counts };
}

/** Ngắt kho Drive: file mới lưu lại trong database; file đã lên Drive vẫn còn trên Drive. */
export async function disconnectGoogleDrive(): Promise<{ error?: string; success?: string }> {
  await requireAdmin();
  const row = await prisma.googleDriveConnection.findUnique({ where: { id: "default" }, select: { token: true } });
  await prisma.googleDriveConnection.deleteMany({ where: { id: "default" } });
  forgetDriveAccessToken();
  if (row) await revokeGoogleToken(row.token);
  revalidatePath("/admin");
  return { success: "Đã ngắt kết nối Google Drive. File mới sẽ lưu trong app cho tới khi kết nối lại." };
}
