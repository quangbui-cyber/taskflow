import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { after } from "next/server";
import { trashDriveFileSafe } from "@/lib/driveStorage";
import { openStoredFileResponse, storedFileResponse } from "@/lib/storedFileResponse";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function findAccessibleFile(
  projectId: string,
  fileId: string,
  userId: string,
  userRole: string
) {
  const file = await prisma.projectFile.findFirst({
    where: { id: fileId, projectId },
    include: {
      project: {
        select: {
          ownerId: true,
          members: {
            where: { userId },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!file) return null;
  const canAccess =
    userRole === "ADMIN" ||
    file.project.ownerId === userId ||
    file.project.members.length > 0;
  return canAccess ? file : null;
}

export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; fileId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "Phiên đăng nhập đã hết hạn." },
      { status: 401 }
    );
  }

  const { id: projectId, fileId } = await params;
  const file = await findAccessibleFile(
    projectId,
    fileId,
    user.id,
    user.role
  );
  if (!file) {
    return Response.json(
      { error: "Không tìm thấy tài liệu hoặc bạn không có quyền xem." },
      { status: 404 }
    );
  }

  if (new URL(request.url).searchParams.get("open") === "1") {
    return openStoredFileResponse(file, user.email);
  }
  return storedFileResponse(file);
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: { params: Promise<{ id: string; fileId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "Phiên đăng nhập đã hết hạn." },
      { status: 401 }
    );
  }

  const { id: projectId, fileId } = await params;
  const file = await findAccessibleFile(
    projectId,
    fileId,
    user.id,
    user.role
  );
  if (!file) {
    return Response.json(
      { error: "Không tìm thấy tài liệu hoặc bạn không có quyền xem." },
      { status: 404 }
    );
  }

  const canDelete =
    user.role === "ADMIN" ||
    file.project.ownerId === user.id ||
    file.uploaderId === user.id;
  if (!canDelete) {
    return Response.json(
      { error: "Bạn chỉ có thể xóa tài liệu do mình tải lên." },
      { status: 403 }
    );
  }

  await prisma.projectFile.delete({ where: { id: fileId } });
  after(() => trashDriveFileSafe(file.driveFileId));
  revalidatePath(`/projects/${projectId}`);
  return Response.json({ success: true });
}
