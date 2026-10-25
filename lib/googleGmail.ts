import nodemailer from "nodemailer";
import {
  canSendGmail,
  clearGoogleConnection,
  googleAccessToken,
  GoogleNotConnectedError,
  isGoogleApiSetupError,
} from "@/lib/googleWorkspace";

/** Gửi email bằng chính hộp thư Gmail của người dùng (Gmail API, quyền chỉ gửi). */

export type GmailMessage = {
  fromName: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
  messageId?: string;
  inReplyTo?: string;
  subject: string;
  text: string;
  html: string;
};

/** Dựng thư MIME (tiêu đề tiếng Việt, HTML + chữ thường) bằng nodemailer, không gửi. */
export async function buildGmailRawMessage(from: { name: string; address: string }, message: GmailMessage) {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  const info = await composer.sendMail({
    from,
    to: message.to,
    cc: message.cc?.length ? message.cc : undefined,
    replyTo: message.replyTo,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    references: message.inReplyTo,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return (info.message as Buffer).toString("base64url");
}

/** Gửi thư từ hộp thư Gmail của người dùng. Ném GoogleNotConnectedError nếu chưa kết nối. */
export async function sendViaGmail(userId: string, message: GmailMessage) {
  const { accessToken, email } = await googleAccessToken(userId, canSendGmail);
  const raw = await buildGmailRawMessage({ name: message.fromName, address: email }, message);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) {
    const detail = await response.text().catch(() => "");
    // Gmail API chưa bật: lỗi cấu hình, không xoá kết nối của người dùng.
    if (isGoogleApiSetupError(detail)) throw new Error("Gmail API is not enabled for this Google Cloud project.");
    await clearGoogleConnection(userId);
    throw new GoogleNotConnectedError();
  }
  if (!response.ok) throw new Error(`Gmail send failed (${response.status}).`);
}
