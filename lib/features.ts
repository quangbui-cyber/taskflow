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

/**
 * Biên bản họp bằng AI chỉ bật khi lịch họp đang bật và đã khai báo đủ:
 * GROQ_API_KEY (chép lời), GEMINI_API_KEY (viết biên bản) và
 * BLOB_READ_WRITE_TOKEN (kho Vercel Blob riêng tư giữ file ghi âm tạm).
 * Đặt MEETING_RECAPS_ENABLED=false để tắt dù đã có đủ khoá.
 */
export function meetingRecapsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!meetingsEnabled(env)) return false;
  const flag = env.MEETING_RECAPS_ENABLED?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return Boolean(
    env.GROQ_API_KEY?.trim() && env.GEMINI_API_KEY?.trim() && env.BLOB_READ_WRITE_TOKEN?.trim()
  );
}

export const MEETING_RECAPS_DISABLED_MESSAGE =
  "Chức năng biên bản họp chưa được cấu hình. Nhờ quản trị viên xem mục Biên bản họp trong DEPLOY.md.";
