const MAX_PROFILE_NAME_LENGTH = 80;

/** Chuẩn hoá tên hiển thị người dùng tự đặt; null nếu rỗng. */
export function normalizeProfileName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROFILE_NAME_LENGTH);
  return name || null;
}
