import type { EmailMessage } from "@/lib/email";
import { emailLogo, renderHandwriting, renderSwash } from "@/lib/emailHandwriting";

/** Chỉ tài khoản này được thấy nút và gửi thử thư sinh nhật (gửi về chính hộp thư của họ). */
export const BIRTHDAY_TEST_EMAIL = "quang.bui@creativestation.vn";

const LIME = "#a8d431";
const INK = "#1f2a08";
const GREEN = "#587216";
const TEXT = "#3f3f46";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

type InlineImage = NonNullable<EmailMessage["inlineImages"]>[number];

/** Thư chúc mừng sinh nhật: logo, tiêu đề và lời ký viết tay (ảnh nhúng), nội dung là chữ thật. */
export function buildBirthdayEmail(name: string, recipient: string): EmailMessage {
  const logo = emailLogo();
  const title = renderHandwriting(
    [
      { text: "Chúc mừng", size: 120, color: INK, bold: true },
      { text: "sinh nhật", size: 120, color: INK, bold: true },
    ],
    "middle"
  );
  const swash = renderSwash(INK, LIME, GREEN);
  const greeting = renderHandwriting(
    [{ text: `${name} thân mến,`, size: 42, color: "#18181b", bold: true }],
    "middle"
  );
  const signature = renderHandwriting(
    [
      { text: "Thương mến,", size: 38, color: "#18181b", bold: true },
      { text: "Cả nhà Ga", size: 52, color: GREEN, bold: true },
    ],
    "end"
  );

  const images: (InlineImage & { width: number; height: number; alt: string })[] = [
    { cid: "logo@ga", filename: "logo.png", ...logo, contentType: "image/png", alt: "Creative Station" },
    { cid: "title@ga", filename: "title.png", ...title, contentType: "image/png", alt: "Chúc mừng sinh nhật" },
    { cid: "swash@ga", filename: "swash.png", ...swash, contentType: "image/png", alt: "" },
    { cid: "greeting@ga", filename: "greeting.png", ...greeting, contentType: "image/png", alt: `${name} thân mến,` },
    { cid: "sign@ga", filename: "sign.png", ...signature, contentType: "image/png", alt: "Thương mến, Cả nhà Ga" },
  ];
  const img = (cid: string, maxWidth?: number) => {
    const image = images.find((item) => item.cid === cid)!;
    const width = maxWidth ? Math.min(image.width, maxWidth) : image.width;
    return `<img src="cid:${cid}" alt="${escapeHtml(image.alt)}" width="${width}" style="display:block;margin:0 auto;border:0;width:${width}px;max-width:100%;height:auto">`;
  };

  const paragraphs = [
    "Chúc mừng sinh nhật bạn. Hôm nay, cả nhà Ga muốn gửi đến bạn những lời chúc ấm áp nhất.",
    "Cảm ơn bạn vì đã mang đến cho Ga sự tận tâm, những tiếng cười và cả sự tử tế trong từng ngày. Có bạn ở đây, Ga ấm áp hơn rất nhiều.",
    "Hôm nay, hãy cho phép mình chậm lại một chút, ăn một bữa thật ngon và ở bên những người bạn thương. Chúc bạn một tuổi mới thật nhiều sức khỏe, bình an và hạnh phúc.",
  ];

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="580" cellpadding="0" cellspacing="0" style="width:100%;max-width:580px;background:#fffdf8;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#27272a">
<tr><td align="center" style="padding:34px 28px 0">${img("logo@ga")}</td></tr>
<tr><td align="center" style="padding:26px 20px 0">${img("title@ga", 400)}</td></tr>
<tr><td align="center" style="padding:2px 20px 0">${img("swash@ga", 420)}</td></tr>
<tr><td align="center" style="padding:14px 28px 0">${img("greeting@ga", 320)}</td></tr>
<tr><td align="center" style="padding:10px 46px 4px;font-size:15px;line-height:30px;color:${TEXT}">
${paragraphs.map((text) => `<p style="margin:12px 0">${escapeHtml(text)}</p>`).join("\n")}
</td></tr>
<tr><td align="right" style="padding:16px 40px 30px"><div style="display:inline-block">${img("sign@ga", 240)}</div></td></tr>
<tr><td height="8" style="height:8px;line-height:8px;font-size:0;background:${LIME}">&nbsp;</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `${name} thân mến,`,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    "Thương mến,",
    "Cả nhà Ga",
  ].join("\n");

  return {
    to: [recipient],
    subject: `Chúc mừng sinh nhật ${name} · Cả nhà Ga gửi bạn`,
    text,
    html,
    inlineImages: images.map(({ cid, filename, content, contentType }) => ({
      cid, filename, content, contentType,
    })),
  };
}
