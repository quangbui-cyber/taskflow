import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Google Chat gửi sự kiện (app được thêm vào nhóm, có người nhắn app...) tới địa chỉ này.
 * Google bắt buộc Chat app có địa chỉ nhận sự kiện thì mới cho người trong công ty dùng app.
 * App chỉ gửi thông báo một chiều, nên ở đây chỉ kiểm tra yêu cầu thật sự đến từ Google rồi trả lời ngắn.
 */

// Chat app thường: Google ký bằng tài khoản chat@system, audience = số dự án Google Cloud.
const CHAT_ISSUER = "chat@system.gserviceaccount.com";
const CHAT_KEYS = createRemoteJWKSet(new URL(`https://www.googleapis.com/service_accounts/v1/jwk/${CHAT_ISSUER}`));
// Chat app dạng Workspace add-on: Google ký bằng ID token của tài khoản dịch vụ add-on, audience = địa chỉ này.
const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const ADDON_SERVICE_ACCOUNT = /^service-\d+@gcp-sa-gsuiteaddons\.iam\.gserviceaccount\.com$/;

/** Số dự án Google Cloud, đọc từ OAuth client ID ("723564408506-xxxx.apps.googleusercontent.com"). */
export function googleProjectNumber(env: Record<string, string | undefined> = process.env) {
  const explicit = env.GOOGLE_CLOUD_PROJECT_NUMBER?.trim();
  if (explicit && /^\d+$/.test(explicit)) return explicit;
  const match = env.GOOGLE_CLIENT_ID?.trim().match(/^(\d+)-/);
  return match ? match[1] : null;
}

export async function verifyChatEventRequest(authorization: string | null, endpointUrl: string): Promise<boolean> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
  const projectNumber = googleProjectNumber();
  if (projectNumber) {
    try {
      await jwtVerify(token, CHAT_KEYS, { issuer: CHAT_ISSUER, audience: projectNumber });
      return true;
    } catch {
      // thử kiểu add-on
    }
  }
  try {
    const { payload } = await jwtVerify(token, GOOGLE_KEYS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: endpointUrl,
    });
    return typeof payload.email === "string" && ADDON_SERVICE_ACCOUNT.test(payload.email) && payload.email_verified === true;
  } catch {
    return false;
  }
}

const HELP_TEXT =
  "Chào bạn, mình là MyCreative, mình sẽ đồng hành cùng team để triển khai dự án thành công nhé!";

/** Loại sự kiện, đọc được cả kiểu Chat app thường lẫn kiểu Workspace add-on. */
export function chatEventKind(body: unknown): "added" | "message" | "other" {
  const event = (body ?? {}) as Record<string, unknown>;
  if (event.type === "ADDED_TO_SPACE") return "added";
  if (event.type === "MESSAGE") return "message";
  const chat = (event.chat ?? {}) as Record<string, unknown>;
  if (chat.addedToSpacePayload) return "added";
  if (chat.messagePayload) return "message";
  return "other";
}

/** Câu trả lời cho sự kiện (Workspace add-on trả theo định dạng riêng của add-on). */
export function chatEventReply(body: unknown) {
  const kind = chatEventKind(body);
  if (kind === "other") return {};
  const text = HELP_TEXT;
  const isAddon = Boolean((body as Record<string, unknown> | null)?.chat);
  return isAddon
    ? { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text } } } } }
    : { text };
}
