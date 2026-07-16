export const MAX_PROJECT_FILE_SIZE = 4 * 1024 * 1024;

const ALLOWED_FILE_TYPES = new Map<string, string>([
  ["application/pdf", "PDF"],
  ["image/jpeg", "Hình ảnh"],
  ["image/png", "Hình ảnh"],
  ["image/webp", "Hình ảnh"],
  ["application/msword", "Word"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Word",
  ],
  ["application/vnd.ms-excel", "Excel"],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Excel",
  ],
  ["application/vnd.ms-powerpoint", "PowerPoint"],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "PowerPoint",
  ],
  ["text/plain", "Văn bản"],
  ["text/csv", "CSV"],
]);

const MIME_BY_EXTENSION = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".doc", "application/msword"],
  [
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [".xls", "application/vnd.ms-excel"],
  [
    ".xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [".ppt", "application/vnd.ms-powerpoint"],
  [
    ".pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  [".txt", "text/plain"],
  [".csv", "text/csv"],
]);

export type ProjectUpload = {
  name: string;
  mimeType: string;
  size: number;
  data: Uint8Array<ArrayBuffer>;
};

function fileExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 ? name.slice(lastDot).toLowerCase() : "";
}

export function projectFileTypeLabel(mimeType: string) {
  return ALLOWED_FILE_TYPES.get(mimeType) ?? "Tài liệu";
}

export function formatProjectFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export async function readProjectUpload(
  value: FormDataEntryValue | null
): Promise<ProjectUpload | null> {
  if (!(value instanceof File) || value.size === 0) return null;

  if (value.size > MAX_PROJECT_FILE_SIZE) {
    throw new Error("Tài liệu phải nhỏ hơn 4 MB.");
  }

  const extension = fileExtension(value.name);
  const mimeType =
    ALLOWED_FILE_TYPES.has(value.type) && value.type
      ? value.type
      : MIME_BY_EXTENSION.get(extension);

  if (!mimeType || !ALLOWED_FILE_TYPES.has(mimeType)) {
    throw new Error(
      "Chỉ hỗ trợ PDF, hình ảnh, Word, Excel, PowerPoint, TXT hoặc CSV."
    );
  }

  const name = value.name
    .replace(/[\\/\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  if (!name) throw new Error("Tên tài liệu không hợp lệ.");

  return {
    name,
    mimeType,
    size: value.size,
    data: new Uint8Array(await value.arrayBuffer()),
  };
}
