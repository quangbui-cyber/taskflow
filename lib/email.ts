import nodemailer, { type Transporter } from "nodemailer";

export type EmailResult = { ok: true } | { ok: false; error: string };

export type EmailMessage = {
  to: string[];
  cc?: string[];
  /** Người nhận bấm "Trả lời" thì thư về địa chỉ này (vd người gửi duyệt). */
  replyTo?: string;
  /** Đặt Message-ID riêng để email sau trả lời đúng luồng thư. */
  messageId?: string;
  /** Message-ID của email gốc: Gmail/Outlook gom vào cùng luồng. */
  inReplyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Đính kèm lời mời lịch (.ics) để Gmail/Outlook hiện nút thêm vào lịch */
  calendar?: { method: "REQUEST" | "CANCEL"; content: string };
  /** Ảnh nhúng trong thư (tham chiếu bằng cid trong html), hiện ngay không cần "tải ảnh". */
  inlineImages?: { cid: string; filename: string; content: Buffer; contentType: string }[];
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
      cc: message.cc?.length ? message.cc : undefined,
      replyTo: message.replyTo,
      messageId: message.messageId,
      inReplyTo: message.inReplyTo,
      references: message.inReplyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.inlineImages?.map((image) => ({
        filename: image.filename,
        content: image.content,
        contentType: image.contentType,
        cid: image.cid,
        contentDisposition: "inline" as const,
      })),
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

// ---------- Gửi thư cho khách: người gửi riêng từng thương hiệu ----------

export type DeliveryResult = { ok: true } | { ok: false; error: string; transient: boolean };

export type SenderOptions = {
  /** Tên hiện trong hộp thư người nhận: "Ga – Creative Station". */
  fromName: string;
  replyTo?: string | null;
  /** Tiền tố biến môi trường SMTP riêng ("GA" → SMTP_GA_USER, SMTP_GA_APP_PASSWORD); trống = SMTP mặc định. */
  smtpRef?: string | null;
};

const senderTransports = new Map<string, { transport: Transporter; user: string }>();

/** Chuẩn hoá tiền tố biến môi trường: chỉ chữ in hoa, số và gạch dưới. */
export function normalizeSmtpRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ref = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
  return ref || null;
}

function senderCredentials(smtpRef: string | null | undefined, env: NodeJS.ProcessEnv = process.env) {
  const ref = normalizeSmtpRef(smtpRef);
  if (!ref) return smtpCredentials();
  const user = env[`SMTP_${ref}_USER`]?.trim();
  const pass = env[`SMTP_${ref}_APP_PASSWORD`]?.replace(/\s+/g, "");
  return user && pass ? { user, pass } : null;
}

/** Thương hiệu này đã có thông tin đăng nhập SMTP (riêng, hoặc mặc định) hay chưa. */
export function isSenderConfigured(smtpRef?: string | null): boolean {
  return senderCredentials(smtpRef) !== null;
}

/** Hộp thư thật dùng để gửi cho thương hiệu này. */
export function senderAddress(smtpRef?: string | null): string | null {
  return senderCredentials(smtpRef)?.user ?? null;
}

function senderTransport(smtpRef: string | null | undefined) {
  const ref = normalizeSmtpRef(smtpRef);
  if (!ref) {
    const mailer = transport();
    const user = emailSenderAddress();
    return mailer && user ? { transport: mailer, user } : null;
  }
  const auth = senderCredentials(ref);
  if (!auth) return null;
  const cachedSender = senderTransports.get(ref);
  if (cachedSender && cachedSender.user === auth.user) return cachedSender;
  const port = Number(process.env[`SMTP_${ref}_PORT`] ?? process.env.SMTP_PORT) || 465;
  const created = {
    transport: nodemailer.createTransport({
      host: process.env[`SMTP_${ref}_HOST`]?.trim() || process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth,
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    }),
    user: auth.user,
  };
  senderTransports.set(ref, created);
  return created;
}

/** Lỗi SMTP 4xx, mất kết nối, hết giờ chờ: thử lại được. Lỗi 5xx (địa chỉ không tồn tại…): không. */
export function classifySmtpError(error: unknown): { transient: boolean; message: string } {
  const info = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof info.code === "string" ? info.code : "";
  const responseCode = typeof info.responseCode === "number" ? info.responseCode : 0;
  const response = typeof info.response === "string" ? info.response : "";
  if (code === "EAUTH") {
    return { transient: false, message: "Máy chủ email từ chối đăng nhập. Kiểm tra mật khẩu ứng dụng SMTP." };
  }
  if (/5\.4\.5|quota|limit exceeded/i.test(response)) {
    return { transient: true, message: "Hộp thư gửi đã chạm giới hạn thư mỗi ngày của Gmail." };
  }
  if (responseCode >= 400 && responseCode < 500) {
    return { transient: true, message: `Máy chủ email tạm từ chối (${responseCode}).` };
  }
  if (responseCode >= 500) {
    if (/5\.1\.1|does not exist|no such user|user unknown/i.test(response)) {
      return { transient: false, message: "Địa chỉ email không tồn tại." };
    }
    return { transient: false, message: `Máy chủ email từ chối thư (${responseCode}).` };
  }
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "ECONNREFUSED"].includes(code)) {
    return { transient: true, message: "Mất kết nối tới máy chủ email." };
  }
  return { transient: true, message: "Không gửi được thư." };
}

/** Gửi một thư cho khách bằng hộp thư của thương hiệu; trả về lỗi đã phân loại để quyết định thử lại. */
export async function deliverEmail(message: EmailMessage, sender: SenderOptions): Promise<DeliveryResult> {
  const mailer = senderTransport(sender.smtpRef);
  if (!mailer) {
    return { ok: false, transient: false, error: "Chưa cấu hình hộp thư SMTP cho thương hiệu gửi này." };
  }
  try {
    const delivery = await mailer.transport.sendMail({
      from: { name: sender.fromName, address: mailer.user },
      to: message.to,
      replyTo: sender.replyTo || undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.inlineImages?.map((image) => ({
        filename: image.filename,
        content: image.content,
        contentType: image.contentType,
        cid: image.cid,
        contentDisposition: "inline" as const,
      })),
    });
    if (delivery.rejected?.length) {
      return { ok: false, transient: false, error: "Địa chỉ bị máy chủ email từ chối." };
    }
    return { ok: true };
  } catch (error) {
    const { transient, message: reason } = classifySmtpError(error);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
    console.warn("Customer email delivery failed:", /^[A-Z0-9_]+$/.test(code) ? code : "UNKNOWN");
    return { ok: false, transient, error: reason };
  }
}
