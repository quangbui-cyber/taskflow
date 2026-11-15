import type { EmailMessage } from "@/lib/email";
import { emailLogo, renderHandwriting, renderSwash, type HandwritingImage } from "@/lib/emailHandwriting";
import { fillTemplate, recipientVariables, splitParagraphs } from "@/lib/customerMail";

const LIME = "#a8d431";
const INK = "#1f2a08";
const GREEN = "#587216";
const TEXT = "#3f3f46";

export type MailContent = {
  subject: string;
  title: string;
  greeting: string;
  body: string;
  signOff: string;
  signature: string;
};

export type MailRecipientData = {
  fullName: string;
  email: string | null;
  callName: string | null;
  salutation: string | null;
  group: string | null;
};

type InlineImage = NonNullable<EmailMessage["inlineImages"]>[number];
type Image = InlineImage & HandwritingImage & { alt: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

// Tiêu đề, nét lượn và chữ ký giống nhau cho cả chiến dịch: vẽ một lần rồi dùng lại.
const sharedCache = new Map<string, HandwritingImage>();
function cached(key: string, draw: () => HandwritingImage) {
  let image = sharedCache.get(key);
  if (!image) {
    image = draw();
    if (sharedCache.size > 50) sharedCache.clear();
    sharedCache.set(key, image);
  }
  return image;
}

/**
 * Thư theo mẫu Ga: logo, tiêu đề viết tay, lời chào viết tay riêng từng người (vẽ ở máy chủ
 * vì Gmail không tải phông web), nội dung là chữ thật, chữ ký viết tay; kèm bản text thuần.
 */
export function buildCustomerEmail(content: MailContent, recipient: MailRecipientData): EmailMessage {
  const variables = recipientVariables(recipient);
  const subject = fillTemplate(content.subject, variables).replace(/\s+/g, " ").trim();
  const greeting = fillTemplate(content.greeting, variables).replace(/\s+/g, " ").trim();
  const paragraphs = splitParagraphs(content.body).map((paragraph) => fillTemplate(paragraph, variables));
  const title = content.title.trim();
  const signOff = content.signOff.trim();
  const signature = content.signature.trim();

  const images: Image[] = [
    { cid: "logo@ga", filename: "logo.png", ...emailLogo(), contentType: "image/png", alt: "Creative Station" },
  ];
  if (title) {
    const art = cached(`title:${title}`, () =>
      renderHandwriting([{ text: title, size: 84, color: INK, bold: true }], "middle")
    );
    images.push({ cid: "title@ga", filename: "title.png", ...art, contentType: "image/png", alt: title });
    const swash = cached("swash", () => renderSwash(INK, LIME, GREEN));
    images.push({ cid: "swash@ga", filename: "swash.png", ...swash, contentType: "image/png", alt: "" });
  }
  if (greeting) {
    const art = renderHandwriting([{ text: greeting, size: 38, color: "#18181b", bold: true }], "middle");
    images.push({ cid: "greeting@ga", filename: "greeting.png", ...art, contentType: "image/png", alt: greeting });
  }
  if (signOff || signature) {
    const lines = [
      ...(signOff ? [{ text: signOff, size: 24, color: "#18181b", bold: true }] : []),
      ...(signature ? [{ text: signature, size: 34, color: GREEN, bold: true }] : []),
    ];
    const art = cached(`sign:${signOff}|${signature}`, () => renderHandwriting(lines, "end"));
    images.push({
      cid: "sign@ga", filename: "sign.png", ...art, contentType: "image/png",
      alt: [signOff, signature].filter(Boolean).join(" "),
    });
  }

  const img = (cid: string, maxWidth?: number, margin = "0 auto") => {
    const image = images.find((item) => item.cid === cid);
    if (!image) return "";
    const width = maxWidth ? Math.min(image.width, maxWidth) : image.width;
    return `<img src="cid:${cid}" alt="${escapeHtml(image.alt)}" width="${width}" style="display:block;margin:${margin};border:0;width:${width}px;max-width:100%;height:auto">`;
  };
  const has = (cid: string) => images.some((image) => image.cid === cid);

  const rows = [
    `<tr><td align="center" style="padding:22px 28px 0">${img("logo@ga")}</td></tr>`,
    has("title@ga") ? `<tr><td align="center" style="padding:10px 20px 0">${img("title@ga", 300)}</td></tr>` : "",
    has("swash@ga") ? `<tr><td align="center" style="padding:0 20px 0">${img("swash@ga", 300)}</td></tr>` : "",
    has("greeting@ga")
      ? `<tr><td align="left" style="padding:14px 40px 0">${img("greeting@ga", 300, "0 0 0 -8px")}</td></tr>`
      : "",
    `<tr><td align="left" style="padding:4px 40px 0;font-size:15px;line-height:25px;color:${TEXT}">
${paragraphs.map((text) => `<p style="margin:10px 0">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`).join("\n")}
</td></tr>`,
    has("sign@ga")
      ? `<tr><td align="right" style="padding:8px 40px 18px"><div style="display:inline-block">${img("sign@ga", 140)}</div></td></tr>`
      : `<tr><td style="padding:0 0 18px"></td></tr>`,
    `<tr><td height="8" style="height:8px;line-height:8px;font-size:0;background:${LIME}">&nbsp;</td></tr>`,
  ];

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fffdf8;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#27272a">
${rows.filter(Boolean).join("\n")}
</table></td></tr></table></body></html>`;

  const text = [
    ...(greeting ? [greeting, ""] : []),
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(signOff ? [signOff] : []),
    ...(signature ? [signature] : []),
  ].join("\n").trim();

  return {
    to: recipient.email ? [recipient.email] : [],
    subject,
    text,
    html,
    inlineImages: images.map(({ cid, filename, content, contentType }) => ({ cid, filename, content, contentType })),
  };
}

/** Bản xem trước trong app: thay ảnh cid bằng data URI để hiện được trong khung xem. */
export function previewHtml(message: EmailMessage): string {
  let html = message.html;
  for (const image of message.inlineImages ?? []) {
    html = html.replaceAll(`cid:${image.cid}`, `data:${image.contentType};base64,${image.content.toString("base64")}`);
  }
  return html;
}
