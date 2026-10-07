import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { attachmentDisposition } from "@/lib/contentDisposition";
import { prisma } from "@/lib/prisma";
import { canManageDocuments, documentDownloadName } from "@/lib/documents";

export const runtime = "nodejs";

// Mọi người dùng đã đăng nhập đều tải được tài liệu dùng chung.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "Phiên đăng nhập đã hết hạn." },
      { status: 401 }
    );
  }

  const { fileId } = await params;
  const file = await prisma.documentFile.findUnique({ where: { id: fileId } });
  if (!file) {
    return Response.json(
      { error: "Không tìm thấy tài liệu." },
      { status: 404 }
    );
  }

  const downloadName = documentDownloadName(file.title, file.fileName);
  return new Response(file.data, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      "Content-Disposition": attachmentDisposition(downloadName),
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> }
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
      { error: "Chỉ Admin được xoá tài liệu." },
      { status: 403 }
    );
  }

  const { fileId } = await params;
  const deleted = await prisma.documentFile.deleteMany({
    where: { id: fileId },
  });
  if (deleted.count === 0) {
    return Response.json(
      { error: "Không tìm thấy tài liệu." },
      { status: 404 }
    );
  }
  revalidatePath("/documents");
  return Response.json({ success: true });
}
