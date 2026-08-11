import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { prisma } from "@/lib/prisma";

type RecognitionChatMessage = {
  recognitionId: string;
  senderName: string;
  recipientName: string;
  message: string;
  categoryLabel: string;
};

export type RecognitionWebhookActionResult = {
  ok: boolean;
  message: string;
};

const GOOGLE_CHAT_HOST = "chat.googleapis.com";
const WEBHOOK_TIMEOUT_MS = 4_000;
const SETTING_KEY = "recognition_google_chat_webhook";
const ENCRYPTION_VERSION = "v1";

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Thiếu SESSION_SECRET để bảo vệ webhook.");
  return createHash("sha256").update(secret).digest();
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv, tag, encrypted]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(":");
}

function decryptSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(":");
  if (version !== ENCRYPTION_VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Định dạng webhook đã lưu không hợp lệ.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function safeChatText(value: string) {
  return value
    .replaceAll("<", "‹")
    .replaceAll(">", "›")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

export function validateRecognitionWebhookUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== GOOGLE_CHAT_HOST ||
      !url.pathname.startsWith("/v1/spaces/") ||
      !url.pathname.endsWith("/messages") ||
      !url.searchParams.get("key") ||
      !url.searchParams.get("token")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function storedWebhookUrl() {
  const setting = await prisma.integrationSetting.findUnique({
    where: { key: SETTING_KEY },
    select: { encryptedValue: true },
  });
  if (!setting) return null;

  try {
    return validateRecognitionWebhookUrl(decryptSecret(setting.encryptedValue));
  } catch {
    console.error("[recognition-chat] Không thể đọc webhook đã lưu.");
    return null;
  }
}

async function configuredWebhookUrl() {
  const stored = await storedWebhookUrl();
  if (stored) return stored;
  const environmentValue = process.env.GOOGLE_CHAT_RECOGNITION_WEBHOOK_URL;
  return environmentValue ? validateRecognitionWebhookUrl(environmentValue) : null;
}

async function postChatText(url: URL, text: string): Promise<RecognitionWebhookActionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, message: `Google Chat phản hồi lỗi HTTP ${response.status}.` };
    }
    return { ok: true, message: "Kết nối Google Chat hoạt động tốt." };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      message: timedOut
        ? "Google Chat phản hồi quá lâu. Hãy thử lại."
        : "Không thể kết nối đến Google Chat.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRecognitionWebhookStatus() {
  const setting = await prisma.integrationSetting.findUnique({
    where: { key: SETTING_KEY },
    select: { updatedAt: true },
  });
  if (setting) {
    return { configured: true, source: "APP" as const, updatedAt: setting.updatedAt };
  }
  if (validateRecognitionWebhookUrl(process.env.GOOGLE_CHAT_RECOGNITION_WEBHOOK_URL ?? "")) {
    return { configured: true, source: "ENV" as const, updatedAt: null };
  }
  return { configured: false, source: null, updatedAt: null };
}

export async function saveAndTestRecognitionWebhook(
  rawUrl: string
): Promise<RecognitionWebhookActionResult> {
  const url = validateRecognitionWebhookUrl(rawUrl);
  if (!url) {
    return { ok: false, message: "URL webhook Google Chat không hợp lệ." };
  }

  const test = await postChatText(
    url,
    "⭐ *GÓC CẢM ƠN*\nWebhook đã được kết nối thành công. Từ giờ các lời cảm ơn công khai sẽ xuất hiện tại đây."
  );
  if (!test.ok) return test;

  await prisma.integrationSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, encryptedValue: encryptSecret(url.toString()) },
    update: { encryptedValue: encryptSecret(url.toString()) },
  });
  return { ok: true, message: "Đã kết nối và lưu webhook Google Chat." };
}

export async function testSavedRecognitionWebhook() {
  const url = await configuredWebhookUrl();
  if (!url) return { ok: false, message: "Chưa có webhook để kiểm tra." };
  return postChatText(url, "⭐ *GÓC CẢM ƠN*\nTin nhắn kiểm tra kết nối từ ứng dụng.");
}

export async function removeSavedRecognitionWebhook() {
  await prisma.integrationSetting.deleteMany({ where: { key: SETTING_KEY } });
}

function recognitionChatText(input: RecognitionChatMessage) {
  const sender = safeChatText(input.senderName);
  const recipient = safeChatText(input.recipientName);
  const message = safeChatText(input.message);
  const category = safeChatText(input.categoryLabel);

  return [
    "⭐ *GÓC CẢM ƠN*",
    `*${sender}* đã gửi một ngôi sao đến *${recipient}*`,
    `> ${message.replaceAll("\n", "\n> ")}`,
    `_Chủ đề: ${category}_`,
  ].join("\n");
}

export async function sendRecognitionToGoogleChat(input: RecognitionChatMessage) {
  const webhookUrl = await configuredWebhookUrl();
  if (!webhookUrl) return;

  const result = await postChatText(webhookUrl, recognitionChatText(input));
  if (!result.ok) {
    console.error(
      `[recognition-chat] Không thể gửi lời cảm ơn ${input.recognitionId}. ${result.message}`
    );
  }
}
