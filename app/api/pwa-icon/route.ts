import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";

// Logo vuông Creative Station dùng làm biểu tượng app trên màn hình chính.
const LOGO_FILE = path.join(process.cwd(), "public", "brand", "creative-station-chat-avatar.png");
let logoDataUri: Promise<string> | null = null;

function logo() {
  logoDataUri ??= readFile(LOGO_FILE).then((file) => `data:image/png;base64,${file.toString("base64")}`);
  return logoDataUri;
}

export async function GET(request: Request) {
  const requestedSize = Number(new URL(request.url).searchParams.get("size"));
  const size = [96, 180, 192, 512].includes(requestedSize) ? requestedSize : 192;
  return new ImageResponse(
    createElement("img", { src: await logo(), width: size, height: size, style: { width: "100%", height: "100%" } }),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
