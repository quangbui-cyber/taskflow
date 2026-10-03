// Quy tắc của tab Tài liệu: ai cũng xem và tải về được, chỉ Admin quản lý.

const MAX_NAME_LENGTH = 120;

export function canManageDocuments(role: string) {
  return role === "ADMIN";
}

/** Chuẩn hoá tên bộ hồ sơ / tên tài liệu do người dùng đặt; null nếu rỗng. */
export function normalizeDocumentName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input
    .replace(/[\\/\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name || null;
}

/** Chỉ nhận link http/https hợp lệ; trả về URL đã chuẩn hoá hoặc null. */
export function normalizeDocumentUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 2000) return null;
  // Cho phép dán link thiếu giao thức ("drive.google.com/...").
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Tên gợi ý từ tên file: bỏ phần mở rộng ("Hop dong mau.docx" → "Hop dong mau"). */
export function titleFromFileName(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

/** Tên khi tải về: tên hiển thị + phần mở rộng của file gốc. */
export function documentDownloadName(title: string, fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  const extension = lastDot > 0 ? fileName.slice(lastDot).toLowerCase() : "";
  return title.toLowerCase().endsWith(extension) ? title : `${title}${extension}`;
}
