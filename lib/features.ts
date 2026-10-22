/**
 * Công tắc bật/tắt tính năng theo môi trường.
 *
 * Lịch họp bật mặc định ở mọi môi trường (production, preview, máy dev).
 * Muốn tạm ẩn: đặt biến môi trường MEETINGS_ENABLED=false (hoặc 0) rồi deploy lại.
 * Khi ẩn, không dữ liệu nào bị xoá.
 */
export function meetingsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.MEETINGS_ENABLED?.trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}

export const MEETINGS_DISABLED_MESSAGE = "Chức năng đặt lịch họp đang tạm ẩn.";
