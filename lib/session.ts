import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret) {
  // Không được phép chạy tiếp với secret mặc định: ai biết chuỗi đó sẽ tự ký
  // được cookie phiên đăng nhập và vào app với bất kỳ vai trò nào.
  throw new Error(
    "Thiếu biến môi trường SESSION_SECRET. Thêm vào .env (xem .env.example) rồi khởi động lại app."
  );
}
const secret = new TextEncoder().encode(rawSecret);

const COOKIE_NAME = "session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 ngày

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
