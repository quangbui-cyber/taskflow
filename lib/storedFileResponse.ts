import { attachmentDisposition } from "@/lib/contentDisposition";
import { DriveNotConnectedError, GOOGLE_DOC_MIME_TYPE, downloadDriveFile, driveViewUrl } from "@/lib/googleDrive";
import { MAX_PROJECT_FILE_SIZE } from "@/lib/projectFiles";

type StoredFile = {
  name: string;
  mimeType: string;
  size: number;
  data: Uint8Array | null;
  driveFileId: string | null;
};

/** Link xem file trên Drive cho giao diện (null khi file còn nằm trong database). */
export function storedFileDriveUrl(file: { driveFileId: string | null; mimeType: string }) {
  return file.driveFileId ? driveViewUrl(file.driveFileId, file.mimeType) : null;
}

/** Tên file khi tải về: Google Doc xuất ra .docx. */
export function downloadName(file: { name: string; mimeType: string }) {
  return file.mimeType === GOOGLE_DOC_MIME_TYPE && !/\.docx$/i.test(file.name) ? `${file.name}.docx` : file.name;
}

const headers = (name: string, mimeType: string, size?: number) => ({
  "Content-Type": mimeType,
  ...(size !== undefined ? { "Content-Length": String(size) } : {}),
  "Content-Disposition": attachmentDisposition(name),
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
});

/**
 * Trả nội dung file cho người đã được kiểm quyền. File còn trong database thì trả thẳng;
 * file trên Drive thì app lấy từ Drive rồi trả về. File rất lớn (quá giới hạn trả về của Vercel)
 * thì mở trên Google Drive — người xem đã được share thư mục dự án.
 */
export async function storedFileResponse(file: StoredFile): Promise<Response> {
  if (file.data) return new Response(new Uint8Array(file.data), { headers: headers(file.name, file.mimeType, file.size) });
  if (!file.driveFileId) {
    return Response.json({ error: "Tệp không còn nội dung." }, { status: 404 });
  }
  if (file.mimeType !== GOOGLE_DOC_MIME_TYPE && file.size > MAX_PROJECT_FILE_SIZE) {
    return Response.redirect(driveViewUrl(file.driveFileId, file.mimeType), 302);
  }
  try {
    const drive = await downloadDriveFile(file.driveFileId, file.mimeType);
    const isDoc = file.mimeType === GOOGLE_DOC_MIME_TYPE;
    const type = isDoc ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : file.mimeType;
    return new Response(drive.body, { headers: headers(downloadName(file), type, isDoc ? undefined : file.size) });
  } catch (error) {
    if (error instanceof DriveNotConnectedError) {
      return Response.json({ error: "Kho Google Drive đang mất kết nối. Báo Admin kết nối lại." }, { status: 503 });
    }
    console.error("Drive download failed", error);
    return Response.json({ error: "Không lấy được tệp từ Google Drive. Thử lại sau." }, { status: 502 });
  }
}
