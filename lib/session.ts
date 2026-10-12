import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

function getSessionSecret() {
  const rawSecret = process.env.SESSION_SECRET;
  if (!rawSecret) {
    // Không được phép chạy tiếp với secret mặc định: ai biết chuỗi đó sẽ tự ký
    // được cookie phiên đăng nhập và vào app với bất kỳ vai trò nào.
    throw new Error(
      "Thiếu biến môi trường SESSION_SECRET. Thêm vào .env (xem .env.example) rồi khởi động lại app."
    );
  }
  return new TextEncoder().encode(rawSecret);
}

const COOKIE_NAME = "session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 ngày

export type SessionData = {
  userId: string;
  sessionVersion: number;
};

export async function createSession(userId: string, sessionVersion: number) {
  const secret = getSessionSecret();
  const token = await new SignJWT({ sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
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

export async function getSession(): Promise<SessionData | null> {
  const secret = getSessionSecret();
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== "string") return null;

    // Cookie tạo trước khi có cơ chế thu hồi phiên không có claim này; coi là
    // version 0 để deploy không tự đăng xuất toàn bộ người dùng hiện tại.
    const sessionVersion = payload.sessionVersion ?? 0;
    if (
      typeof sessionVersion !== "number" ||
      !Number.isSafeInteger(sessionVersion) ||
      sessionVersion < 0
    ) {
      return null;
    }
    return { userId: payload.sub, sessionVersion };
  } catch {
    return null;
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
