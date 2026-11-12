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

/**
 * Tài chính (tab Tài chính của dự án: Báo giá, IC/AC, duyệt IC) và danh bạ Nhà cung cấp.
 * Đang tạm ẩn: tắt mặc định ở mọi môi trường. Muốn bật lại, đặt FINANCE_ENABLED=true (hoặc 1)
 * rồi deploy lại. Khi ẩn, không dữ liệu nào bị xoá.
 */
export function financeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.FINANCE_ENABLED?.trim().toLowerCase();
  return flag === "true" || flag === "1";
}

/**
 * Góc Đọc & Cảm Hứng (câu chuyện sáng tạo từ các bậc thầy quảng cáo).
 * Bật mặc định. Đặt CREATIVE_ENABLED=false (hoặc 0) để tạm ẩn.
 */
export function creativeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.CREATIVE_ENABLED?.trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}

export const CREATIVE_DISABLED_MESSAGE = "Góc Đọc & Cảm Hứng đang tạm ẩn.";

/** Khu vực Khách hàng tắt mặc định; chỉ bật khi CRM_ENABLED là true hoặc 1. */
export function crmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.CRM_ENABLED?.trim().toLowerCase();
  return flag === "true" || flag === "1";
}

export const CRM_DISABLED_MESSAGE = "Khu vực Khách hàng đang tắt.";


/**
 * crm54: CRM is opened per person during the pilot. CRM_ENABLED stays the master switch.
 * Admin always has access; others need their id in CrmSetting access.users. Disabled users never do.
 */
export const CRM_ACCESS_SETTING_KEY = "access.users";
export const CRM_ACCESS_MAX_USERS = 500;
export type CrmAccessUser = { id: string; role: string; isActive?: boolean; deletedAt?: Date | null };

/** Strict parser: malformed values are read as null, which callers treat as an empty list (Admin only). */
export function parseCrmAccessUsers(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > CRM_ACCESS_MAX_USERS) return null;
  if (value.some((id) => typeof id !== "string" || !id.trim() || id.length > 64 || id !== id.trim())) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value] as string[];
}

export function crmAccessFor(user: CrmAccessUser | null | undefined, settings: { enabled: boolean; accessUserIds: readonly string[] | null }): boolean {
  if (!settings.enabled || !user?.id) return false;
  if (user.isActive === false || (user.deletedAt !== undefined && user.deletedAt !== null)) return false;
  if (user.role === "ADMIN") return true;
  return (settings.accessUserIds ?? []).includes(user.id);
}
