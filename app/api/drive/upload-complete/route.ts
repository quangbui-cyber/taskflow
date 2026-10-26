import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadAccess, verifyUploadTicket } from "@/lib/driveUpload";
import { syncProjectSharingSafe, trashDriveFileSafe } from "@/lib/driveStorage";
import { driveFileMeta, driveViewUrl } from "@/lib/googleDrive";
import { prisma } from "@/lib/prisma";
import { notifyTaskFileAdded } from "@/lib/taskFileNotify";

export const runtime = "nodejs";

/** Trình duyệt báo đã đẩy xong file lên Drive: kiểm lại trên Drive rồi mới lưu vào app. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { ticket?: unknown; driveFileId?: unknown } | null;
  if (typeof body?.ticket !== "string" || typeof body.driveFileId !== "string") {
    return Response.json({ error: "Thiếu thông tin tệp." }, { status: 400 });
  }
  const ticket = await verifyUploadTicket(body.ticket).catch(() => null);
  if (!ticket || ticket.userId !== user.id) {
    return Response.json({ error: "Phiên tải lên đã hết hạn. Hãy tải lại tệp." }, { status: 400 });
  }
  const access = await uploadAccess(ticket.target, user);
  if (!access || access.projectId !== ticket.projectId) {
    return Response.json({ error: "Bạn không có quyền tải tệp lên đây." }, { status: 403 });
  }

  const driveFileId = body.driveFileId;
  const meta = await driveFileMeta(driveFileId).catch(() => null);
  // Chỉ nhận đúng file vừa tải vào đúng thư mục, đúng dung lượng đã khai.
  if (!meta || meta.trashed || !meta.parents.includes(ticket.folderId) || meta.size !== ticket.size) {
    return Response.json({ error: "Không xác nhận được tệp trên Google Drive. Hãy tải lại." }, { status: 400 });
  }
  const already = await Promise.all([
    prisma.projectFile.findFirst({ where: { driveFileId }, select: { id: true } }),
    prisma.taskFile.findFirst({ where: { driveFileId }, select: { id: true } }),
  ]);
  if (already.some(Boolean)) return Response.json({ error: "Tệp này đã được lưu." }, { status: 409 });

  try {
    if (ticket.target.type === "project") {
      const file = await prisma.projectFile.create({
        data: {
          projectId: access.projectId,
          uploaderId: user.id,
          name: ticket.name,
          mimeType: ticket.mimeType,
          size: ticket.size,
          driveFileId,
        },
        select: {
          id: true, name: true, mimeType: true, size: true, createdAt: true,
          uploader: { select: { id: true, name: true, avatarUrl: true } },
        },
      });
      after(() => syncProjectSharingSafe(access.projectId));
      revalidatePath(`/projects/${access.projectId}`);
      return Response.json({ file: { ...file, driveUrl: driveViewUrl(driveFileId, file.mimeType) } });
    }

    const file = await prisma.taskFile.create({
      data: {
        taskId: ticket.target.taskId,
        uploaderId: user.id,
        kind: ticket.target.kind,
        name: ticket.name,
        mimeType: ticket.mimeType,
        size: ticket.size,
        driveFileId,
      },
      select: {
        id: true, kind: true, name: true, mimeType: true, size: true, createdAt: true,
        uploader: { select: { id: true, name: true } },
      },
    });
    if (access.task) await notifyTaskFileAdded(access.task, user, ticket.target.kind, ticket.name);
    after(() => syncProjectSharingSafe(access.projectId));
    revalidatePath(`/projects/${access.projectId}`);
    return Response.json({ file: { ...file, driveUrl: driveViewUrl(driveFileId, file.mimeType) } });
  } catch (error) {
    console.error("Saving Drive upload failed", error);
    after(() => trashDriveFileSafe(driveFileId));
    return Response.json({ error: "Không lưu được tệp. Thử lại sau." }, { status: 500 });
  }
}
