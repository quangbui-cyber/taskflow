/** Chuẩn hoá và kiểm tra email đăng nhập (admin đổi email cho một tài khoản). */

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LoginEmailResult = { email: string } | { error: string };

export function parseLoginEmail(raw: unknown): LoginEmailResult {
  const email = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!email) return { error: "Vui lòng nhập email mới." };
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { error: "Email không hợp lệ." };
  }
  return { email };
}
