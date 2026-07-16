import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readProjectUpload } from "@/lib/projectFiles";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "Phiên đăng nhập đã hết hạn." },
      { status: 401 }
    );
  }

  const { id: projectId } = await params;
  const project = await prisma.project.findFirst({
    where:
      user.role === "ADMIN"
        ? { id: projectId }
        : {
            id: projectId,
            members: { some: { userId: user.id } },
          },
    select: { id: true },
  });

  if (!project) {
    return Response.json(
      { error: "Bạn không có quyền tải tài liệu lên dự án này." },
      { status: 403 }
    );
  }

  try {
    const formData = await request.formData();
    const upload = await readProjectUpload(formData.get("file"));
    if (!upload) {
      return Response.json(
        { error: "Vui lòng chọn một tài liệu." },
        { status: 400 }
      );
    }

    const file = await prisma.projectFile.create({
      data: {
        projectId,
        uploaderId: user.id,
        name: upload.name,
        mimeType: upload.mimeType,
        size: upload.size,
        data: upload.data,
      },
      select: {
        id: true,
        name: true,
        mimeType: true,
        size: true,
        createdAt: true,
        uploader: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });

    revalidatePath(`/projects/${projectId}`);
    return Response.json({ file });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không thể tải tài liệu lên.",
      },
      { status: 400 }
    );
  }
}
