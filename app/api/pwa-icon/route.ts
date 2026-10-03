import { createElement } from "react";
import { ImageResponse } from "next/og";

export function GET(request: Request) {
  const requestedSize = Number(new URL(request.url).searchParams.get("size"));
  const size = [96, 180, 192, 512].includes(requestedSize) ? requestedSize : 192;
  return new ImageResponse(createElement("div", {
    style: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#a5d522", color: "#172006", fontSize: Math.round(size * 0.48), fontWeight: 900 },
  }, "CS"), { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } });
}
