import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canManageDocuments,
  normalizeDocumentName,
  titleFromFileName,
} from "@/lib/documents";
import { readProjectUpload } from "@/lib/projectFiles";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "Phiên đăng nhập đã hết hạn." },
      { status: 401 }
    );
  }
  if (!canManageDocuments(user.role)) {
    return Response.json(
      { error: "Chỉ Admin được tải tài liệu lên." },
      { status: 403 }
    );
  }

  const { setId } = await params;
  const set = await prisma.documentSet.findUnique({
    where: { id: setId },
    select: { id: true },
  });
  if (!set) {
    return Response.json(
      { error: "Bộ hồ sơ không tồn tại." },
      { status: 404 }
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
    const title =
      normalizeDocumentName(formData.get("title")) ??
      titleFromFileName(upload.name);

    const file = await prisma.documentFile.create({
      data: {
        setId,
        title,
        fileName: upload.name,
        mimeType: upload.mimeType,
        size: upload.size,
        data: upload.data,
        uploaderId: user.id,
      },
      select: { id: true },
    });

    revalidatePath("/documents");
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
