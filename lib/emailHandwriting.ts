import { readFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

// Gmail/Outlook không tải phông web, nên chữ viết tay trong email được vẽ sẵn thành
// ảnh PNG bằng chính file phông trong dự án. Ảnh vẽ gấp đôi để rõ nét trên màn hình Retina.
const FONT_FILE = path.join(process.cwd(), "assets", "fonts", "DancingScript.ttf");
const SCALE = 2;
const PAD = 10;

export type HandwritingImage = {
  content: Buffer;
  /** Kích thước hiển thị (px) trong email. */
  width: number;
  height: number;
};

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function renderSvg(svg: string): HandwritingImage {
  const options = {
    font: {
      fontFiles: [FONT_FILE],
      loadSystemFonts: false,
      defaultFontFamily: "Dancing Script",
    },
  };
  // Vẽ thử để đo khung chữ thật, rồi cắt sát khung đó.
  const box = new Resvg(svg, options).getBBox();
  const width = Math.ceil((box?.width ?? 100) + PAD * 2);
  const height = Math.ceil((box?.height ?? 40) + PAD * 2);
  const cropped = svg
    .replace(/^<svg ([^>]*?)width="\d+" height="\d+"/, "<svg $1")
    .replace(
      /^<svg /,
      `<svg width="${width}" height="${height}" viewBox="${Math.floor((box?.x ?? 0) - PAD)} ${Math.floor((box?.y ?? 0) - PAD)} ${width} ${height}" `
    );
  const png = new Resvg(cropped, {
    ...options,
    fitTo: { mode: "width", value: width * SCALE },
  })
    .render()
    .asPng();
  return { content: Buffer.from(png), width, height };
}

/** Vẽ một hoặc nhiều dòng chữ viết tay, canh giữa hoặc canh phải trong cùng một ảnh. */
export function renderHandwriting(
  lines: { text: string; size: number; color: string; bold?: boolean }[],
  align: "middle" | "end" = "middle"
): HandwritingImage {
  const anchorX = 1000;
  let y = 0;
  const rows = lines.map((line) => {
    y += line.size * 1.1;
    const stroke = line.bold ? ` stroke="${line.color}" stroke-width="${line.size * 0.025}"` : "";
    return `<text x="${anchorX}" y="${y}" text-anchor="${align}" font-family="Dancing Script" font-size="${line.size}" fill="${line.color}"${stroke}>${escapeXml(line.text)}</text>`;
  });
  return renderSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${Math.ceil(y + 80)}">${rows.join("")}</svg>`
  );
}

/** Nét lượn dưới tiêu đề, kết thúc bằng hình thoi xanh của thương hiệu. */
export function renderSwash(ink: string, accent: string, accentStroke: string): HandwritingImage {
  return renderSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="60">` +
      `<path d="M10 36 C90 46 190 16 300 30 C350 36 372 32 392 28" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>` +
      `<path d="M402 18 L411 28 L402 38 L393 28 Z" fill="${accent}" stroke="${accentStroke}" stroke-width="1.5"/></svg>`
  );
}

let cachedLogo: Buffer | null = null;
/** Logo Creative Station bản nhỏ dành cho email (PNG nền trong suốt). */
export function emailLogo() {
  cachedLogo ??= readFileSync(
    path.join(process.cwd(), "public", "brand", "creative-station-logo-email.png")
  );
  return { content: cachedLogo, width: 150, height: 41 };
}
