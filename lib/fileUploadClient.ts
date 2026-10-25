import { MAX_PROJECT_FILE_SIZE } from "@/lib/projectFiles";

/**
 * Tải một file của dự án hoặc task. Khi Google Drive đã kết nối, trình duyệt đẩy file thẳng lên Drive
 * (tối đa 100 MB); nếu chưa kết nối hoặc Drive lỗi thì gửi qua app như cũ (tối đa 4 MB).
 */

export type UploadTargetInput =
  | { target: "project"; projectId: string }
  | { target: "task"; taskId: string; kind: "BRIEF" | "RESULT" };

async function errorMessage(response: Response, fallback: string) {
  // Vercel trả 413 dạng văn bản (không phải JSON) khi request vượt giới hạn.
  if (response.status === 413) return "Tệp quá lớn — tối đa 4 MB khi chưa có Google Drive.";
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

async function legacyUpload<T>(input: UploadTargetInput, file: File): Promise<T> {
  if (file.size > MAX_PROJECT_FILE_SIZE) {
    throw new Error("Tệp lớn hơn 4 MB. Kho Google Drive chưa kết nối nên chưa tải được tệp lớn.");
  }
  const body = new FormData();
  body.append("file", file);
  if (input.target === "task") body.append("kind", input.kind);
  const url = input.target === "project" ? `/api/projects/${input.projectId}/files` : `/api/tasks/${input.taskId}/files`;
  const response = await fetch(url, { method: "POST", body });
  if (!response.ok) throw new Error(await errorMessage(response, "Không thể tải tệp lên."));
  const result = (await response.json()) as { file: T };
  return result.file;
}

export async function uploadStoredFile<T>(input: UploadTargetInput, file: File): Promise<T> {
  const session = await fetch("/api/drive/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, name: file.name, mimeType: file.type, size: file.size }),
  });
  if (session.status === 409) return legacyUpload<T>(input, file);
  if (!session.ok) throw new Error(await errorMessage(session, "Không thể tải tệp lên."));
  const { uploadUrl, ticket, mimeType } = (await session.json()) as { uploadUrl: string; ticket: string; mimeType: string };

  let driveFileId: string;
  try {
    const put = await fetch(uploadUrl, {
      method: "PUT",
      // Đúng loại file đã khai khi mở phiên tải lên.
      headers: { "Content-Type": mimeType },
      body: file,
    });
    if (!put.ok) throw new Error(`Drive ${put.status}`);
    driveFileId = ((await put.json()) as { id: string }).id;
  } catch (error) {
    // Mạng chặn Google hoặc trình duyệt chặn CORS: file nhỏ vẫn gửi qua app được.
    if (file.size <= MAX_PROJECT_FILE_SIZE) return legacyUpload<T>(input, file);
    throw new Error(error instanceof Error && error.message.startsWith("Drive") ? "Google Drive từ chối tệp. Thử lại sau." : "Không kết nối được Google Drive. Kiểm tra mạng rồi thử lại.");
  }

  const done = await fetch("/api/drive/upload-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, driveFileId }),
  });
  if (!done.ok) throw new Error(await errorMessage(done, "Không lưu được tệp."));
  return ((await done.json()) as { file: T }).file;
}
