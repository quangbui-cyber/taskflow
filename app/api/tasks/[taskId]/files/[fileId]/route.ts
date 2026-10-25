import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { after } from "next/server";
import { trashDriveFileSafe } from "@/lib/driveStorage";
import { storedFileResponse } from "@/lib/storedFileResponse";
import { prisma } from "@/lib/prisma";
import { findAccessibleTask } from "@/lib/taskFiles";

export const runtime = "nodejs";

type Context = { params: Promise<{ taskId: string; fileId: string }> };

async function loadFile(context: Context) {
  const user = await getCurrentUser();
  if (!user) {
    return {
      error: Response.json(
        { error: "Phiên đăng nhập đã hết hạn." },
        { status: 401 }
      ),
    };
  }

  const { taskId, fileId } = await context.params;
  const task = await findAccessibleTask(taskId, user);
  const file = task
    ? await prisma.taskFile.findFirst({ where: { id: fileId, taskId } })
    : null;
  if (!task || !file) {
    return {
      error: Response.json(
        { error: "Không tìm thấy tệp hoặc bạn không có quyền xem." },
        { status: 404 }
      ),
    };
  }
  return { user, task, file };
}

export async function GET(_request: Request, context: Context) {
  const result = await loadFile(context);
  if ("error" in result) return result.error;
  const { file } = result;

  return storedFileResponse(file);
}

export async function DELETE(_request: Request, context: Context) {
  const result = await loadFile(context);
  if ("error" in result) return result.error;
  const { user, task, file } = result;

  const canDelete =
    user.role === "ADMIN" ||
    file.uploaderId === user.id ||
    task.creatorId === user.id ||
    task.project.ownerId === user.id;
  if (!canDelete) {
    return Response.json(
      { error: "Bạn chỉ có thể xoá tệp do mình tải lên." },
      { status: 403 }
    );
  }

  await prisma.taskFile.delete({ where: { id: file.id } });
  after(() => trashDriveFileSafe(file.driveFileId));
  revalidatePath(`/projects/${task.projectId}`);
  return Response.json({ success: true });
}
