import { Dancing_Script, Literata, Playfair_Display } from "next/font/google";

// Chữ viết tay cho lời chào trên trang chủ. next/font tải font lúc build và tự
// phục vụ từ domain của app (CSP chỉ cho font-src 'self').
export const handwriting = Dancing_Script({
  subsets: ["latin", "vietnamese"],
  weight: ["700"],
  display: "swap",
});

export const serifHeading = Playfair_Display({
  subsets: ["latin", "vietnamese"],
  style: ["normal", "italic"],
  weight: ["600", "700"],
  display: "swap",
});

export const serifBody = Literata({
  subsets: ["latin", "vietnamese"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
  display: "swap",
});

