import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "myCreative · Creative Station",
    short_name: "myCreative",
    description: "Quản lý dự án và công việc của Creative Station",
    lang: "vi",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#a5d522",
    icons: [192, 512].map((size) => ({ src: `/api/pwa-icon?size=${size}`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" })),
  };
}
