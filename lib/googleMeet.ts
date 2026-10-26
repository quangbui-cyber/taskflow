import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { googleAuthConfigured, googleClientCredentials, newGoogleOauthAttempt } from "@/lib/googleAuth";
import { prisma } from "@/lib/prisma";

/**
 * Tạo link Google Meet bằng tài khoản Google của người đặt lịch (Google Meet REST API).
 * Chỉ xin quyền "tạo phòng Meet", không đọc lịch hay email. Quyền này được xin riêng
 * (không gộp vào đăng nhập), nên người đăng nhập bằng mật khẩu cũng kết nối được.
 */

export const GOOGLE_MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.created";

const MEET_COOKIE = "google_meet_oauth";
const ATTEMPT_MAX_AGE = 10 * 60;

export function googleMeetConfigured() {
  return googleAuthConfigured();
}

function secret(): string {
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error("SESSION_SECRET is required for Google Meet.");
  return raw;
}

// ---------- Mã hoá refresh token trước khi lưu vào DB ----------

function tokenKey(): Buffer {
  return createHash("sha256").update(`google-meet-token:${secret()}`).digest();
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(
    "."
  );
}

/** null nếu token hỏng hoặc SESSION_SECRET đã đổi (khi đó người dùng kết nối lại). */
export function decryptToken(stored: string): string | null {
  try {
    const [version, iv, tag, data] = stored.split(".");
    if (version !== "v1" || !iv || !tag || !data) return null;
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------- Lượt xin quyền (OAuth) ----------

export function googleMeetCookieName() {
  return MEET_COOKIE;
}

export function googleMeetCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: ATTEMPT_MAX_AGE,
    path: "/api/google/meet",
  };
}

export async function newGoogleMeetAttempt(userId: string, redirectUri: string) {
  const client = googleClientCredentials();
  if (!client) throw new Error("Google is not configured.");
  const attempt = newGoogleOauthAttempt(redirectUri);
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_MEET_SCOPE,
    access_type: "offline",
    // Luôn hỏi lại để Google trả refresh token (Google chỉ trả ở lần đồng ý).
    prompt: "consent",
    state: attempt.state,
    code_challenge: attempt.challenge,
    code_challenge_method: "S256",
  }).toString();
  const cookie = await new SignJWT({ state: attempt.state, verifier: attempt.verifier, redirectUri, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("mycreative")
    .setAudience("google-meet")
    .setIssuedAt()
    .setExpirationTime(`${ATTEMPT_MAX_AGE}s`)
    .sign(new TextEncoder().encode(secret()));
  return { authorizationUrl, cookie };
}

export async function verifyGoogleMeetAttempt(cookie: string) {
  const { payload } = await jwtVerify(cookie, new TextEncoder().encode(secret()), {
    issuer: "mycreative",
    audience: "google-meet",
  });
  const { state, verifier, redirectUri, userId } = payload;
  if (
    typeof state !== "string" ||
    typeof verifier !== "string" ||
    typeof redirectUri !== "string" ||
    typeof userId !== "string"
  ) {
    throw new Error("Invalid Google Meet attempt.");
  }
  return { state, verifier, redirectUri, userId };
}

/** Đổi mã xác nhận lấy refresh token; null nếu Google từ chối hoặc người dùng bỏ tick quyền tạo Meet. */
export async function exchangeGoogleMeetCode(code: string, attempt: { verifier: string; redirectUri: string }) {
  const client = googleClientCredentials();
  if (!client) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: attempt.redirectUri,
      grant_type: "authorization_code",
      code_verifier: attempt.verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const tokens = (await response.json()) as { refresh_token?: unknown; scope?: unknown };
  if (typeof tokens.refresh_token !== "string") return null;
  if (typeof tokens.scope !== "string" || !tokens.scope.split(" ").includes(GOOGLE_MEET_SCOPE)) return null;
  return tokens.refresh_token;
}

// ---------- Tạo phòng Meet ----------

export class GoogleMeetNotConnectedError extends Error {}
export class GoogleMeetApiDisabledError extends Error {}

async function accessTokenFor(userId: string): Promise<string> {
  const client = googleClientCredentials();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { googleMeetToken: true } });
  const refreshToken = user?.googleMeetToken ? decryptToken(user.googleMeetToken) : null;
  if (!client || !refreshToken) throw new GoogleMeetNotConnectedError();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown };
  if (!response.ok || typeof body.access_token !== "string") {
    // Người dùng đã thu hồi quyền hoặc token hết hạn: xoá để lần sau kết nối lại.
    if (body.error === "invalid_grant") {
      await prisma.user.update({ where: { id: userId }, data: { googleMeetToken: null } });
      throw new GoogleMeetNotConnectedError();
    }
    throw new Error(`Google token refresh failed (${response.status}).`);
  }
  return body.access_token;
}

/** Link phòng Meet mới, dạng https://meet.google.com/abc-defg-hij. */
export async function createGoogleMeetSpace(userId: string): Promise<string> {
  const accessToken = await accessTokenFor(userId);
  const response = await fetch("https://meet.googleapis.com/v2/spaces", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 403) {
    const detail = await response.text().catch(() => "");
    // Project Google Cloud chưa bật Google Meet REST API: lỗi cấu hình, kết nối lại không giúp được.
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used/i.test(detail)) throw new GoogleMeetApiDisabledError();
  }
  if (response.status === 401 || response.status === 403) {
    // Quyền tạo Meet đã bị gỡ: xoá token để người dùng kết nối lại.
    await prisma.user.update({ where: { id: userId }, data: { googleMeetToken: null } });
    throw new GoogleMeetNotConnectedError();
  }
  if (!response.ok) throw new Error(`Google Meet space creation failed (${response.status}).`);
  const space = (await response.json()) as { meetingUri?: unknown };
  if (typeof space.meetingUri !== "string" || !space.meetingUri.startsWith("https://meet.google.com/")) {
    throw new Error("Google Meet returned no meeting link.");
  }
  return space.meetingUri;
}
