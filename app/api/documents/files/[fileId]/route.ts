import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { attachmentDisposition } from "@/lib/contentDisposition";
import { prisma } from "@/lib/prisma";
import { canManageDocuments, documentDownloadName } from "@/lib/documents";
import { pushDocumentFile, trashDriveFileSafe } from "@/lib/driveStorage";
import { openStoredFileResponse, storedFileResponse } from "@/lib/storedFileResponse";

export const runtime = "nodejs";

// Mọi người dùng đã đăng nhập đều xem và tải được tài liệu dùng chung.
export async function GET(
  request: Request,
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
  const url = new URL(request.url);
  const isOpen = url.searchParams.get("open") === "1" || url.searchParams.get("view") === "1";

  if (isOpen) {
    // 1. Nếu có link Drive do người dùng tự gắn: mở thẳng link đó
    if (file.driveUrl) {
      return Response.redirect(file.driveUrl, 302);
    }
    // 2. Nếu file đã nằm trên Drive của công ty: share quyền xem và chuyển sang Drive
    if (file.driveFileId) {
      return openStoredFileResponse(
        {
          name: downloadName,
          mimeType: file.mimeType,
          size: file.size,
          data: file.data ? new Uint8Array(file.data) : null,
          driveFileId: file.driveFileId,
        },
        user.email
      );
    }
    // 3. Nếu file còn trong database: thử đẩy lên Drive tức thì rồi mở
    if (file.data) {
      try {
        const pushed = await pushDocumentFile(file.id);
        if (pushed) {
          const updated = await prisma.documentFile.findUnique({ where: { id: fileId } });
          if (updated?.driveFileId) {
            return openStoredFileResponse(
              {
                name: downloadName,
                mimeType: updated.mimeType,
                size: updated.size,
                data: null,
                driveFileId: updated.driveFileId,
              },
              user.email
            );
          }
        }
      } catch (error) {
        console.error("Push document to Drive on open failed", error);
      }
      // Chưa lên Drive được: mở inline trên trình duyệt nếu hỗ trợ
      return new Response(new Uint8Array(file.data), {
        headers: {
          "Content-Type": file.mimeType,
          "Content-Length": String(file.size),
          "Content-Disposition": `inline; filename="${encodeURIComponent(downloadName)}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return Response.json({ error: "Tệp không còn nội dung." }, { status: 404 });
  }

  // Tải file về máy (Download)
  if (file.data) {
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.size),
        "Content-Disposition": attachmentDisposition(downloadName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (file.driveFileId) {
    return storedFileResponse({
      name: downloadName,
      mimeType: file.mimeType,
      size: file.size,
      data: null,
      driveFileId: file.driveFileId,
    });
  }

  return Response.json({ error: "Tệp không còn nội dung." }, { status: 404 });
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
  const file = await prisma.documentFile.findUnique({
    where: { id: fileId },
    select: { id: true, driveFileId: true },
  });
  if (!file) {
    return Response.json(
      { error: "Không tìm thấy tài liệu." },
      { status: 404 }
    );
  }

  await prisma.documentFile.delete({ where: { id: fileId } });
  if (file.driveFileId) {
    after(() => trashDriveFileSafe(file.driveFileId));
  }
  revalidatePath("/documents");
  return Response.json({ success: true });
}
