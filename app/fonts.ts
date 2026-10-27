import { Dancing_Script } from "next/font/google";

// Chữ viết tay cho lời chào trên trang chủ. next/font tải font lúc build và tự
// phục vụ từ domain của app (CSP chỉ cho font-src 'self').
export const handwriting = Dancing_Script({
  subsets: ["latin", "vietnamese"],
  weight: ["700"],
  display: "swap",
});
