import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
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

  const fallbackName = file.name.replace(/["\r\n]/g, "_");
  return new Response(file.data, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
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
  revalidatePath(`/projects/${projectId}`);
  return Response.json({ success: true });
}
