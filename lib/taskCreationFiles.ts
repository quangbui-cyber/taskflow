import { MAX_PROJECT_FILE_SIZE, readProjectUpload, validateUploadMeta, type ProjectUpload } from "@/lib/projectFiles";
import type { TaskFileKind } from "@/lib/types";

// Requests carrying the file bytes directly must leave room for the form fields.
export const MAX_INLINE_TASK_FILE_BYTES = MAX_PROJECT_FILE_SIZE;
export const MAX_TASK_CREATION_FILE_SIZE = 25 * 1024 * 1024;
export const TASK_CREATION_UPLOAD_PREFIX = "task-creation/";

export function taskCreationUploadPath(projectId: string, userId: string, uploadId: string) {
  return `${TASK_CREATION_UPLOAD_PREFIX}${projectId}/${userId}/${uploadId}`;
}

export function isTaskCreationUploadPath(pathname: string, projectId: string, userId: string) {
  const uploadId = pathname.slice(pathname.lastIndexOf("/") + 1);
  return (
    /^[a-z0-9_-]+$/i.test(projectId) &&
    /^[a-z0-9_-]+$/i.test(userId) &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uploadId) &&
    pathname === taskCreationUploadPath(projectId, userId, uploadId)
  );
}

export function validateTaskCreationFile(input: { name: string; type: string; size: number }) {
  if (input.size === 0) throw new Error(`Tệp “${input.name}” không có nội dung.`);
  if (input.size > MAX_TASK_CREATION_FILE_SIZE) {
    throw new Error(`Tệp “${input.name}” vượt quá 25 MB.`);
  }
  return validateUploadMeta(input, MAX_TASK_CREATION_FILE_SIZE);
}
export const TASK_FILE_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";

export async function readTaskCreationFiles(formData: FormData) {
  const selected: { kind: TaskFileKind; file: File }[] = [];
  let totalSize = 0;

  for (const [field, kind] of [
    ["briefFiles", "BRIEF"],
    ["resultFiles", "RESULT"],
  ] as const) {
    for (const value of formData.getAll(field)) {
      if (!(value instanceof File)) {
        throw new Error("Tệp đính kèm không hợp lệ.");
      }
      if (!value.name && value.size === 0) continue;
      if (value.size === 0) {
        throw new Error(`Tệp “${value.name}” không có nội dung.`);
      }
      totalSize += value.size;
      if (totalSize > MAX_INLINE_TASK_FILE_BYTES) {
        throw new Error("Tổng dung lượng tệp đính kèm khi tạo task tối đa 4 MB.");
      }
      selected.push({ kind, file: value });
    }
  }

  const uploads: { kind: TaskFileKind; upload: ProjectUpload }[] = [];
  for (const { kind, file } of selected) {
    const upload = await readProjectUpload(file);
    if (upload) uploads.push({ kind, upload });
  }
  return uploads;
}
