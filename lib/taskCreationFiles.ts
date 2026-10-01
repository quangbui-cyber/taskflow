import { MAX_PROJECT_FILE_SIZE, readProjectUpload, type ProjectUpload } from "@/lib/projectFiles";
import type { TaskFileKind } from "@/lib/types";

// The creation action sends all attachments in one multipart request.
// Keep room for form fields below the existing 4.2 MB action body limit.
export const MAX_TASK_CREATION_FILE_SIZE = MAX_PROJECT_FILE_SIZE;
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
      if (totalSize > MAX_TASK_CREATION_FILE_SIZE) {
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
