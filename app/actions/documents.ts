"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { normalizeDocumentName, normalizeDocumentUrl } from "@/lib/documents";
import { trashDocumentSetFolderSafe } from "@/lib/driveStorage";

export type DocumentState = { error?: string; success?: string };

function normalizeDescription(input: unknown) {
  if (typeof input !== "string") return null;
  return input.replace(/\s+/g, " ").trim().slice(0, 300) || null;
}

export async function createDocumentSet(
  _prev: DocumentState,
  formData: FormData
): Promise<DocumentState> {
  await requireAdmin();
  const name = normalizeDocumentName(formData.get("name"));
  if (!name) return { error: "Tên bộ hồ sơ không được để trống." };

  const existing = await prisma.documentSet.findUnique({ where: { name } });
  if (existing) return { error: "Bộ hồ sơ này đã tồn tại." };

  await prisma.documentSet.create({
    data: { name, description: normalizeDescription(formData.get("description")) },
  });
  revalidatePath("/documents");
  return { success: `Đã tạo bộ hồ sơ "${name}".` };
}

export async function renameDocumentSet(
  setId: string,
  rawName: string
): Promise<DocumentState> {
  await requireAdmin();
  const name = normalizeDocumentName(rawName);
  if (!name) return { error: "Tên bộ hồ sơ không được để trống." };

  const duplicate = await prisma.documentSet.findFirst({
    where: { name, id: { not: setId } },
    select: { id: true },
  });
  if (duplicate) return { error: "Bộ hồ sơ này đã tồn tại." };

  const updated = await prisma.documentSet.updateMany({
    where: { id: setId },
    data: { name },
  });
  if (updated.count === 0) return { error: "Bộ hồ sơ không tồn tại." };
  revalidatePath("/documents");
  return { success: `Đã đổi tên thành "${name}".` };
}

export async function deleteDocumentSet(setId: string): Promise<DocumentState> {
  await requireAdmin();
  // onDelete: Cascade → xoá luôn các tài liệu trong bộ hồ sơ
  const deleted = await prisma.documentSet.deleteMany({ where: { id: setId } });
  if (deleted.count === 0) return { error: "Bộ hồ sơ không tồn tại." };
  await trashDocumentSetFolderSafe(setId).catch(() => undefined);
  revalidatePath("/documents");
  return { success: "Đã xoá bộ hồ sơ." };
}

export async function updateDocumentFile(
  fileId: string,
  rawTitle: string,
  rawDriveUrl?: string | null
): Promise<DocumentState> {
  await requireAdmin();
  const title = normalizeDocumentName(rawTitle);
  if (!title) return { error: "Tên tài liệu không được để trống." };

  const driveUrl = rawDriveUrl ? normalizeDocumentUrl(rawDriveUrl) : null;
  if (rawDriveUrl && rawDriveUrl.trim() && !driveUrl) {
    return { error: "Link Google Drive không hợp lệ." };
  }

  const updated = await prisma.documentFile.updateMany({
    where: { id: fileId },
    data: {
      title,
      driveUrl,
    },
  });
  if (updated.count === 0) return { error: "Tài liệu không tồn tại." };
  revalidatePath("/documents");
  return { success: `Đã cập nhật "${title}".` };
}

export async function renameDocumentFile(
  fileId: string,
  rawTitle: string
): Promise<DocumentState> {
  return updateDocumentFile(fileId, rawTitle);
}

export async function addDocumentLink(
  setId: string,
  rawTitle: string,
  rawUrl: string
): Promise<DocumentState> {
  const admin = await requireAdmin();
  const url = normalizeDocumentUrl(rawUrl);
  if (!url) {
    return { error: "Link không hợp lệ. Hãy dán địa chỉ bắt đầu bằng http:// hoặc https://." };
  }
  const title = normalizeDocumentName(rawTitle);
  if (!title) return { error: "Tên tài liệu không được để trống." };

  const set = await prisma.documentSet.findUnique({
    where: { id: setId },
    select: { id: true },
  });
  if (!set) return { error: "Bộ hồ sơ không tồn tại." };

  await prisma.documentLink.create({
    data: { setId, title, url, creatorId: admin.id },
  });
  revalidatePath("/documents");
  return { success: `Đã thêm link "${title}".` };
}

export async function updateDocumentLink(
  linkId: string,
  rawTitle: string,
  rawUrl: string
): Promise<DocumentState> {
  await requireAdmin();
  const url = normalizeDocumentUrl(rawUrl);
  if (!url) {
    return { error: "Link không hợp lệ. Hãy dán địa chỉ bắt đầu bằng http:// hoặc https://." };
  }
  const title = normalizeDocumentName(rawTitle);
  if (!title) return { error: "Tên tài liệu không được để trống." };

  const updated = await prisma.documentLink.updateMany({
    where: { id: linkId },
    data: { title, url },
  });
  if (updated.count === 0) return { error: "Link không tồn tại." };
  revalidatePath("/documents");
  return { success: `Đã cập nhật link "${title}".` };
}

export async function renameDocumentLink(
  linkId: string,
  rawTitle: string
): Promise<DocumentState> {
  await requireAdmin();
  const title = normalizeDocumentName(rawTitle);
  if (!title) return { error: "Tên tài liệu không được để trống." };

  const updated = await prisma.documentLink.updateMany({
    where: { id: linkId },
    data: { title },
  });
  if (updated.count === 0) return { error: "Link không tồn tại." };
  revalidatePath("/documents");
  return { success: `Đã đổi tên thành "${title}".` };
}

export async function deleteDocumentLink(linkId: string): Promise<DocumentState> {
  await requireAdmin();
  const deleted = await prisma.documentLink.deleteMany({ where: { id: linkId } });
  if (deleted.count === 0) return { error: "Link không tồn tại." };
  revalidatePath("/documents");
  return { success: "Đã xoá link." };
}
