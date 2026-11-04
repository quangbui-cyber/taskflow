import { Dancing_Script, Literata, Montserrat } from "next/font/google";

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

// Font nội dung Góc Đọc, hỗ trợ tiếng Việt cùng chữ đậm và nghiêng.
export const serifBody = Literata({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
  fallback: ["Georgia", "serif"],
});
