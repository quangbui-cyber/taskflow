import { Dancing_Script, Montserrat } from "next/font/google";

// Chữ viết tay cho lời chào trên trang chủ. next/font tải font lúc build và tự
// phục vụ từ domain của app (CSP chỉ cho font-src 'self').
export const handwriting = Dancing_Script({
  subsets: ["latin", "vietnamese"],
  weight: ["700"],
  display: "swap",
});

// Font tiêu đề bài viết Góc Đọc: hiện đại, gãy gọn, dứt khoát chuẩn advertising
export const creativeHeading = Montserrat({
  subsets: ["latin", "vietnamese"],
  weight: ["700", "800"],
  display: "swap",
});

// Chữ nội dung bài viết Góc Đọc: Literata. Font tự host (xem @font-face trong globals.css)
// nên build không phải tải gì từ Google Fonts.
export const serifBody = { className: "font-literata" };
