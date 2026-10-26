import { decodeJwt, jwtVerify, SignJWT } from "jose";
import { googleClientCredentials, newGoogleOauthAttempt } from "@/lib/googleAuth";
import { DRIVE_SCOPE, expectedDriveAccount } from "@/lib/googleDrive";

/**
 * Admin kết nối Google Drive một lần bằng tài khoản kho lưu trữ (noreply). Khác kết nối Gmail/Chat
 * của từng người: token này thuộc về cả app. Dùng chung địa chỉ quay về /api/google/gmail/callback
 * đã khai báo với Google, nên cookie đặt cùng đường dẫn.
 */

const COOKIE = "google_drive_oauth";
const COOKIE_PATH = "/api/google/gmail";
const ATTEMPT_MAX_AGE = 10 * 60;
const AUDIENCE = "google-drive";

function secret() {
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error("SESSION_SECRET is required for Google Drive.");
  return new TextEncoder().encode(raw);
}

export function googleDriveCookieName() {
  return COOKIE;
}

export function googleDriveCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: ATTEMPT_MAX_AGE,
    path: COOKIE_PATH,
  };
}

export async function newGoogleDriveAttempt(userId: string, redirectUri: string) {
  const client = googleClientCredentials();
  if (!client) throw new Error("Google is not configured.");
  const attempt = newGoogleOauthAttempt(redirectUri);
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: ["openid", "email", DRIVE_SCOPE].join(" "),
    access_type: "offline",
    prompt: "consent",
    login_hint: expectedDriveAccount(),
    state: attempt.state,
    code_challenge: attempt.challenge,
    code_challenge_method: "S256",
  }).toString();
  const cookie = await new SignJWT({ state: attempt.state, verifier: attempt.verifier, redirectUri, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("mycreative")
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ATTEMPT_MAX_AGE}s`)
    .sign(secret());
  return { authorizationUrl, cookie };
}

export async function verifyGoogleDriveAttempt(cookie: string) {
  const { payload } = await jwtVerify(cookie, secret(), { issuer: "mycreative", audience: AUDIENCE });
  const { state, verifier, redirectUri, userId } = payload;
  if (typeof state !== "string" || typeof verifier !== "string" || typeof redirectUri !== "string" || typeof userId !== "string") {
    throw new Error("Invalid Google Drive attempt.");
  }
  return { state, verifier, redirectUri, userId };
}

/** Đổi mã xác nhận lấy refresh token; null nếu Google từ chối hoặc người dùng bỏ tick quyền Drive. */
export async function exchangeGoogleDriveCode(code: string, attempt: { verifier: string; redirectUri: string }) {
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
  if (typeof tokens.refresh_token !== "string" || typeof tokens.id_token !== "string" || typeof tokens.scope !== "string") {
    return null;
  }
  const scopes = tokens.scope.split(" ");
  if (!scopes.includes(DRIVE_SCOPE)) return null;
  const claims = decodeJwt(tokens.id_token);
  if (claims.aud !== client.clientId || typeof claims.email !== "string" || claims.email_verified !== true) return null;
  return { refreshToken: tokens.refresh_token, email: claims.email.toLowerCase(), scopes: [DRIVE_SCOPE] };
}
