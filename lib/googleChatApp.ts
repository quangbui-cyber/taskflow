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

/**
 * Sửa những lỗi hay gặp khi dán khoá vào Vercel: ngoặc kép bị đổi thành ngoặc cong, cả khối bị bọc
 * trong dấu nháy, hoặc phần khoá bị xuống dòng thật (JSON không cho phép trong chuỗi).
 */
function repairJsonText(text: string) {
  let value = text.trim().replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"');
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith("`") && value.endsWith("`"))) {
    value = value.slice(1, -1).trim();
  }
  let out = "";
  let inString = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (inString && char === "\\") {
      out += char + (value[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString && (char === "\n" || char === "\r")) {
      if (char === "\n") out += "\\n";
      continue;
    }
    out += char;
  }
  return out;
}

type ParseResult = { account: ServiceAccount } | { problem: string };

function readServiceAccount(raw: string | undefined): ParseResult {
  const value = raw?.trim();
  if (!value) return { problem: "Chưa có biến GOOGLE_CHAT_SERVICE_ACCOUNT trên máy chủ." };
  const candidates = [value];
  if (!value.startsWith("{") && !value.startsWith("\"")) {
    try {
      candidates.push(Buffer.from(value, "base64").toString("utf8"));
    } catch {
      // không phải base64
    }
  }
  let sawJson = false;
  for (const text of candidates) {
    for (const attempt of [text, repairJsonText(text)]) {
      try {
        let json: unknown = JSON.parse(attempt);
        // Cả khối JSON bị dán thành một chuỗi.
        if (typeof json === "string") json = JSON.parse(repairJsonText(json));
        if (!json || typeof json !== "object") continue;
        sawJson = true;
        const account = json as Partial<ServiceAccount>;
        if (typeof account.client_email === "string" && typeof account.private_key === "string" &&
            account.private_key.includes("PRIVATE KEY")) {
          return { account: { client_email: account.client_email, private_key: account.private_key.replace(/\\n/g, "\n") } };
        }
      } catch {
        // thử cách đọc tiếp theo
      }
    }
  }
  return {
    problem: sawJson
      ? "Biến GOOGLE_CHAT_SERVICE_ACCOUNT thiếu client_email hoặc private_key. Hãy dán lại toàn bộ file khoá JSON."
      : "Biến GOOGLE_CHAT_SERVICE_ACCOUNT không đọc được. Hãy dán lại toàn bộ nội dung file khoá JSON (từ { đến }).",
  };
}

/** Đọc khoá tài khoản dịch vụ từ GOOGLE_CHAT_SERVICE_ACCOUNT (JSON, hoặc JSON mã hoá base64). */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  const result = readServiceAccount(raw);
  return "account" in result ? result.account : null;
}

function serviceAccount() {
  return parseServiceAccount(process.env.GOOGLE_CHAT_SERVICE_ACCOUNT);
}

/** Lý do Chat app chưa dùng được (null = dùng được), để báo rõ cho người cài đặt. */
export function chatAppProblem(): string | null {
  const result = readServiceAccount(process.env.GOOGLE_CHAT_SERVICE_ACCOUNT);
  return "problem" in result ? result.problem : null;
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
