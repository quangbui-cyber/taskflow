import { decodeJwt, jwtVerify, SignJWT } from "jose";
import { googleAuthConfigured, googleClientCredentials, newGoogleOauthAttempt } from "@/lib/googleAuth";
import { decryptToken, encryptToken } from "@/lib/googleMeet";
import { prisma } from "@/lib/prisma";

/**
 * Kết nối Google Workspace của từng người: một lần cho phép, dùng cho
 * - gửi email duyệt từ hộp thư của họ (chỉ quyền gửi, không đọc thư),
 * - tạo nhóm Google Chat cho dự án và thêm thành viên (không đọc tin nhắn).
 * Tài khoản Google phải trùng email đăng nhập app.
 */

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const CHAT_SPACE_SCOPES = [
  "https://www.googleapis.com/auth/chat.spaces.create",
  "https://www.googleapis.com/auth/chat.memberships",
] as const;
const REQUESTED_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE, ...CHAT_SPACE_SCOPES];

const COOKIE = "google_workspace_oauth";
const COOKIE_PATH = "/api/google/gmail";
const ATTEMPT_MAX_AGE = 10 * 60;

export function googleWorkspaceConfigured() {
  return googleAuthConfigured();
}

export function canSendGmail(scopes: readonly string[]) {
  return scopes.includes(GMAIL_SEND_SCOPE);
}

export function canManageChatSpaces(scopes: readonly string[]) {
  return CHAT_SPACE_SCOPES.every((scope) => scopes.includes(scope));
}

function secret(): string {
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error("SESSION_SECRET is required for Google Workspace.");
  return raw;
}

// ---------- Lượt xin quyền (OAuth) ----------

export function googleWorkspaceCookieName() {
  return COOKIE;
}

export function googleWorkspaceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: ATTEMPT_MAX_AGE,
    path: COOKIE_PATH,
  };
}

/** Trang quay về sau khi kết nối (chỉ đường dẫn nội bộ, tránh chuyển hướng ra ngoài). */
export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/profile";
  return value.slice(0, 300);
}

export async function newGoogleWorkspaceAttempt(
  user: { id: string; email: string },
  redirectUri: string,
  returnTo: string,
) {
  const client = googleClientCredentials();
  if (!client) throw new Error("Google is not configured.");
  const attempt = newGoogleOauthAttempt(redirectUri);
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: REQUESTED_SCOPES.join(" "),
    access_type: "offline",
    // Luôn hỏi lại để Google trả refresh token (Google chỉ trả ở lần đồng ý).
    prompt: "consent",
    // Gợi ý đúng tài khoản công ty để người dùng không chọn nhầm Gmail cá nhân.
    login_hint: user.email,
    state: attempt.state,
    code_challenge: attempt.challenge,
    code_challenge_method: "S256",
  }).toString();
  const cookie = await new SignJWT({
    state: attempt.state,
    verifier: attempt.verifier,
    redirectUri,
    userId: user.id,
    returnTo: safeReturnPath(returnTo),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("mycreative")
    .setAudience("google-workspace")
    .setIssuedAt()
    .setExpirationTime(`${ATTEMPT_MAX_AGE}s`)
    .sign(new TextEncoder().encode(secret()));
  return { authorizationUrl, cookie };
}

export async function verifyGoogleWorkspaceAttempt(cookie: string) {
  const { payload } = await jwtVerify(cookie, new TextEncoder().encode(secret()), {
    issuer: "mycreative",
    audience: "google-workspace",
  });
  const { state, verifier, redirectUri, userId, returnTo } = payload;
  if (
    typeof state !== "string" ||
    typeof verifier !== "string" ||
    typeof redirectUri !== "string" ||
    typeof userId !== "string"
  ) {
    throw new Error("Invalid Google Workspace attempt.");
  }
  return { state, verifier, redirectUri, userId, returnTo: safeReturnPath(typeof returnTo === "string" ? returnTo : null) };
}

/**
 * Đổi mã xác nhận lấy refresh token, địa chỉ email và các quyền được cho phép.
 * null nếu Google từ chối hoặc người dùng không cho quyền nào dùng được.
 */
export async function exchangeGoogleWorkspaceCode(code: string, attempt: { verifier: string; redirectUri: string }) {
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
  const tokens = (await response.json()) as { refresh_token?: unknown; scope?: unknown; id_token?: unknown };
  if (typeof tokens.refresh_token !== "string" || typeof tokens.id_token !== "string") return null;
  if (typeof tokens.scope !== "string") return null;
  // Người dùng có thể bỏ tick từng quyền: chỉ giữ những quyền app dùng.
  const granted = tokens.scope.split(" ").filter((scope) => REQUESTED_SCOPES.includes(scope) && scope.startsWith("https://"));
  if (!canSendGmail(granted) && !canManageChatSpaces(granted)) return null;
  // id_token nhận thẳng từ Google qua HTTPS (máy chủ gọi máy chủ) nên chỉ cần đọc.
  const claims = decodeJwt(tokens.id_token);
  if (claims.aud !== client.clientId || typeof claims.email !== "string" || claims.email_verified !== true) {
    return null;
  }
  return { refreshToken: tokens.refresh_token, email: claims.email.toLowerCase(), scopes: granted };
}

export function encryptGoogleToken(token: string) {
  return encryptToken(token);
}

/** Thu hồi quyền ở phía Google khi ngắt kết nối (lỗi thì bỏ qua). */
export async function revokeGoogleToken(stored: string) {
  const token = decryptToken(stored);
  if (!token) return;
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

export async function clearGoogleConnection(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { googleToken: null, googleEmail: null, googleScopes: [] },
  });
}

// ---------- Lấy access token để gọi API ----------

/** Chưa kết nối, đã thu hồi quyền, hoặc thiếu quyền cần cho việc này. */
export class GoogleNotConnectedError extends Error {}

export async function googleAccessToken(
  userId: string,
  needs: (scopes: readonly string[]) => boolean,
): Promise<{ accessToken: string; email: string }> {
  const client = googleClientCredentials();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleToken: true, googleEmail: true, googleScopes: true },
  });
  const refreshToken = user?.googleToken ? decryptToken(user.googleToken) : null;
  if (!client || !refreshToken || !user?.googleEmail || !needs(user.googleScopes)) {
    throw new GoogleNotConnectedError();
  }

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
    // Người dùng đã thu hồi quyền: xoá để app hiện lại nút kết nối.
    if (body.error === "invalid_grant") {
      await clearGoogleConnection(userId);
      throw new GoogleNotConnectedError();
    }
    throw new Error(`Google token refresh failed (${response.status}).`);
  }
  return { accessToken: body.access_token, email: user.googleEmail };
}

/** Lỗi 403 do project Google Cloud chưa bật / chưa cấu hình API (không phải lỗi của người dùng). */
export function isGoogleApiSetupError(detail: string) {
  return /SERVICE_DISABLED|accessNotConfigured|has not been used|Chat app not found|configure the (Chat )?app/i.test(detail);
}
