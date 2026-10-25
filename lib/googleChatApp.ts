import { importPKCS8, SignJWT } from "jose";
import type { GoogleChatMessage, GoogleChatResult } from "@/lib/googleChat";

/**
 * Gửi tin vào nhóm Google Chat dưới tên Chat app "myCreative" (Google Chat API, xác thực bằng
 * tài khoản dịch vụ của dự án Google Cloud). Thay cho webhook: app phải là thành viên của nhóm,
 * việc này làm tự động khi tạo nhóm từ app.
 */

const CHAT_API = "https://chat.googleapis.com/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHAT_BOT_SCOPE = "https://www.googleapis.com/auth/chat.bot";

type ServiceAccount = { client_email: string; private_key: string };

/** Đọc khoá tài khoản dịch vụ từ GOOGLE_CHAT_SERVICE_ACCOUNT (JSON, hoặc JSON mã hoá base64). */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  const value = raw?.trim();
  if (!value) return null;
  const candidates = [value];
  if (!value.startsWith("{")) {
    try {
      candidates.push(Buffer.from(value, "base64").toString("utf8"));
    } catch {
      return null;
    }
  }
  for (const text of candidates) {
    try {
      const json = JSON.parse(text) as Partial<ServiceAccount>;
      if (typeof json.client_email === "string" && typeof json.private_key === "string") {
        return { client_email: json.client_email, private_key: json.private_key.replace(/\\n/g, "\n") };
      }
    } catch {
      // thử cách đọc tiếp theo
    }
  }
  return null;
}

function serviceAccount() {
  return parseServiceAccount(process.env.GOOGLE_CHAT_SERVICE_ACCOUNT);
}

export function chatAppConfigured() {
  return Boolean(serviceAccount());
}

let cached: { token: string; expiresAt: number } | null = null;

async function chatAppAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const account = serviceAccount();
  if (!account) throw new Error("Google Chat app is not configured.");
  const key = await importPKCS8(account.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: CHAT_BOT_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown };
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(`Google Chat app token failed (${response.status}).`);
  }
  const ttl = typeof body.expires_in === "number" ? body.expires_in : 3000;
  cached = { token: body.access_token, expiresAt: Date.now() + ttl * 1000 };
  return body.access_token;
}

/** Gửi một tin (chữ hoặc thẻ) vào nhóm. Lỗi Chat không làm hỏng thao tác chính. */
export async function sendChatAppMessage(spaceName: string, message: string | GoogleChatMessage): Promise<GoogleChatResult> {
  if (!/^spaces\/[A-Za-z0-9_-]{1,100}$/.test(spaceName)) return { ok: false, error: "Nhóm Google Chat không hợp lệ." };
  try {
    const token = await chatAppAccessToken();
    const payload = typeof message === "string" ? { text: message } : message;
    const response = await fetch(`${CHAT_API}/${spaceName}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) return { ok: true };
    console.error("Google Chat app message error:", response.status, (await response.text().catch(() => "")).slice(0, 300));
    if (response.status === 403 || response.status === 404) {
      return { ok: false, error: "myCreative chưa có trong nhóm Chat. Bấm “Thêm người còn thiếu” để thêm." };
    }
    return { ok: false, error: "Google Chat từ chối tin nhắn. Thử lại sau." };
  } catch (error) {
    console.error("Google Chat app message error:", error);
    return { ok: false, error: "Không thể kết nối Google Chat. Hãy thử lại sau." };
  }
}
