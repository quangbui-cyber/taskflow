/**
 * Công tắc bật/tắt tính năng theo môi trường.
 *
 * Lịch họp đang tạm ẩn trên production (Vercel) và vẫn bật ở máy dev / bản preview.
 * Muốn mở lại trên production: đặt biến môi trường MEETINGS_ENABLED=true trên Vercel
 * rồi deploy lại. Đặt MEETINGS_ENABLED=false để tắt ở mọi môi trường.
 */
export function meetingsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.MEETINGS_ENABLED?.trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return env.VERCEL_ENV !== "production";
}

export const MEETINGS_DISABLED_MESSAGE = "Chức năng đặt lịch họp đang tạm ẩn.";
