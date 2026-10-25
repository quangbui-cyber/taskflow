import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { pushPendingFiles } from "@/lib/driveStorage";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readProjectUpload } from "@/lib/projectFiles";
import { findAccessibleTask, isTaskFileKind } from "@/lib/taskFiles";
import { notifyTaskFileAdded } from "@/lib/taskFileNotify";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "Phiên đăng nhập đã hết hạn." },
      { status: 401 }
    );
  }

  const { taskId } = await params;
  const task = await findAccessibleTask(taskId, user);
  if (!task) {
    return Response.json(
      { error: "Bạn không có quyền tải tệp lên task này." },
      { status: 403 }
    );
  }

  try {
    const formData = await request.formData();
    const kind = formData.get("kind");
    if (!isTaskFileKind(kind)) {
      return Response.json({ error: "Loại tệp không hợp lệ." }, { status: 400 });
    }
    const upload = await readProjectUpload(formData.get("file"));
    if (!upload) {
      return Response.json({ error: "Vui lòng chọn một tệp." }, { status: 400 });
    }

    const file = await prisma.taskFile.create({
      data: {
        taskId,
        uploaderId: user.id,
        kind,
        name: upload.name,
        mimeType: upload.mimeType,
        size: upload.size,
        data: upload.data,
      },
      select: {
        id: true,
        kind: true,
        name: true,
        mimeType: true,
        size: true,
        createdAt: true,
        uploader: { select: { id: true, name: true } },
      },
    });

    await notifyTaskFileAdded(task, user, kind, upload.name);
    after(() => pushPendingFiles({ projectId: task.projectId }));

    revalidatePath(`/projects/${task.projectId}`);
    return Response.json({ file: { ...file, driveUrl: null } });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Không thể tải tệp lên.",
      },
      { status: 400 }
    );
  }
}
