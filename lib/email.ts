import nodemailer, { type Transporter } from "nodemailer";

export type EmailResult = { ok: true } | { ok: false; error: string };

export type EmailMessage = {
  to: string[];
  subject: string;
  text: string;
  html: string;
  /** Đính kèm lời mời lịch (.ics) để Gmail/Outlook hiện nút thêm vào lịch */
  calendar?: { method: "REQUEST" | "CANCEL"; content: string };
};

let cachedTransport: Transporter | null = null;

function smtpCredentials() {
  const user = process.env.SMTP_USER?.trim();
  // Google hiển thị app password thành 4 nhóm cách nhau bằng dấu cách — bỏ đi cho chắc.
  const pass = process.env.SMTP_APP_PASSWORD?.replace(/\s+/g, "");
  return user && pass ? { user, pass } : null;
}

/** Đã khai báo đủ SMTP_USER và SMTP_APP_PASSWORD hay chưa */
export function isEmailConfigured(): boolean {
  return smtpCredentials() !== null;
}

/** Địa chỉ hộp thư dùng để gửi (cũng là ORGANIZER trong lời mời lịch) */
export function emailSenderAddress(): string | null {
  return smtpCredentials()?.user ?? null;
}

export function emailAppUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const configured = env.APP_URL?.trim();
  const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const value = configured || (productionHost ? `https://${productionHost}` : "");
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

function transport(): Transporter | null {
  const auth = smtpCredentials();
  if (!auth) return null;
  if (!cachedTransport) {
    const port = Number(process.env.SMTP_PORT) || 465;
    cachedTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth,
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return cachedTransport;
}

/** Gửi email qua SMTP (mặc định Gmail); lỗi gửi mail không làm hỏng thao tác chính. */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  if (message.to.length === 0) return { ok: true };
  const mailer = transport();
  const sender = emailSenderAddress();
  if (!mailer || !sender) {
    return { ok: false, error: "Chưa cấu hình SMTP_USER / SMTP_APP_PASSWORD." };
  }
  try {
    const delivery = await mailer.sendMail({
      from: {
        name: process.env.MAIL_FROM_NAME?.trim() || "myCreative",
        address: sender,
      },
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      icalEvent: message.calendar
        ? {
            method: message.calendar.method,
            filename: "invite.ics",
            content: message.calendar.content,
          }
        : undefined,
    });
    if (delivery.rejected?.length) {
      console.warn("Email recipients rejected:", delivery.rejected.length);
      return { ok: false, error: "Có địa chỉ người nhận bị máy chủ email từ chối." };
    }
    return { ok: true };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code) : "UNKNOWN";
    console.warn("Email delivery failed:", /^[A-Z0-9_]+$/.test(code) ? code : "UNKNOWN");
    return { ok: false, error: "Không gửi được email. Hãy kiểm tra cấu hình SMTP." };
  }
}
