// Quy tắc thuần của tab Nghỉ phép: tách khỏi Prisma để test được.
// Ngày nghỉ là ngày lịch (không có giờ), lưu dạng Date ở 00:00 UTC.

export const LEAVE_TYPES = [
  { key: "ANNUAL", label: "Nghỉ phép năm", deductsQuota: true },
  { key: "UNPAID", label: "Nghỉ không lương", deductsQuota: false },
] as const;

export const LEAVE_STATUSES = [
  { key: "PENDING", label: "Chờ duyệt", className: "bg-amber-100 text-amber-700" },
  { key: "APPROVED", label: "Đã duyệt", className: "bg-emerald-100 text-emerald-700" },
  { key: "REJECTED", label: "Từ chối", className: "bg-red-100 text-red-700" },
  { key: "CANCELLED", label: "Đã huỷ", className: "bg-zinc-200 text-zinc-700" },
] as const;

export const HALF_DAY_OPTIONS = [
  { key: "AM", label: "Buổi sáng" },
  { key: "PM", label: "Buổi chiều" },
] as const;

export const DEFAULT_ANNUAL_LEAVE_DAYS = 12;
export const MAX_ANNUAL_LEAVE_DAYS = 60;
export const MAX_USED_LEAVE_DAYS = 365;
/** Một đơn tối đa bao nhiêu ngày lịch, và được báo lùi tối đa bao nhiêu ngày. */
export const MAX_LEAVE_SPAN_DAYS = 60;
export const MAX_LEAVE_BACKDATE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function leaveTypeInfo(key: string) {
  return LEAVE_TYPES.find((type) => type.key === key) ?? LEAVE_TYPES[0];
}

export function leaveStatusInfo(key: string) {
  return LEAVE_STATUSES.find((status) => status.key === key) ?? LEAVE_STATUSES[0];
}

export function isLeaveType(key: string) {
  return LEAVE_TYPES.some((type) => type.key === key);
}

export function isHalfDay(key: string) {
  return HALF_DAY_OPTIONS.some((option) => option.key === key);
}

/** "2026-10-05" → Date 00:00 UTC; null nếu sai định dạng hoặc ngày không tồn tại. */
export function parseLeaveDate(input: unknown): Date | null {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return null;
  }
  const date = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === input ? date : null;
}

/** Hôm nay theo giờ Việt Nam, dạng ngày lịch 00:00 UTC. */
export function todayInVietnam(now = new Date()) {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(now);
  return new Date(`${text}T00:00:00.000Z`);
}

export function formatLeaveDate(date: Date) {
  const [year, month, day] = date.toISOString().slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Số ngày nghỉ được tính: ngày làm việc Thứ Hai – Thứ Sáu trong khoảng (kể cả
 * hai đầu), không tính Thứ Bảy và Chủ nhật. Nghỉ nửa ngày tính 0,5.
 */
export function countLeaveDays(start: Date, end: Date, halfDay: string | null) {
  let days = 0;
  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    if (!isWeekend(new Date(time))) days += 1;
  }
  return halfDay && days === 1 ? 0.5 : days;
}

/**
 * Tách số ngày nghỉ của một đơn theo từng tháng (1–12), dùng cho báo cáo: đơn vắt
 * qua hai tháng được chia đúng theo ngày làm việc rơi vào mỗi tháng.
 */
export function leaveDaysByMonth(
  start: Date,
  end: Date,
  halfDay: string | null
): Map<number, number> {
  const months = new Map<number, number>();
  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    const date = new Date(time);
    if (isWeekend(date)) continue;
    const month = date.getUTCMonth() + 1;
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  // Nghỉ nửa ngày chỉ có ở đơn một ngày.
  if (halfDay && months.size === 1) {
    const [[month, days]] = [...months];
    if (days === 1) months.set(month, 0.5);
  }
  return months;
}

/** Kiểm tra khoảng ngày của một đơn mới; trả về thông báo lỗi hoặc null. */
export function leaveRangeError(
  start: Date,
  end: Date,
  halfDay: string | null,
  today = todayInVietnam()
) {
  if (end < start) return "Ngày kết thúc phải từ ngày bắt đầu trở đi.";
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return "Đơn nghỉ không được kéo dài qua hai năm. Hãy tách thành hai đơn.";
  }
  if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_LEAVE_SPAN_DAYS) {
    return `Một đơn nghỉ tối đa ${MAX_LEAVE_SPAN_DAYS} ngày.`;
  }
  if ((today.getTime() - start.getTime()) / DAY_MS > MAX_LEAVE_BACKDATE_DAYS) {
    return `Chỉ được báo nghỉ lùi tối đa ${MAX_LEAVE_BACKDATE_DAYS} ngày.`;
  }
  if (halfDay && start.getTime() !== end.getTime()) {
    return "Nghỉ nửa ngày chỉ áp dụng khi nghỉ trong một ngày.";
  }
  if (countLeaveDays(start, end, halfDay) === 0) {
    return "Khoảng ngày đã chọn chỉ gồm Thứ Bảy, Chủ nhật.";
  }
  return null;
}

/**
 * Quản lý trực tiếp còn hoạt động của người xin (khác chính họ); null nếu chưa có —
 * khi đó đơn do quản lý nghỉ phép duyệt.
 */
export function leaveManagerId(requester: {
  id: string;
  managerId: string | null;
  managerActive?: boolean;
}) {
  if (!requester.managerId || requester.managerId === requester.id) return null;
  return requester.managerActive === false ? null : requester.managerId;
}

/**
 * Ai duyệt một đơn: quản lý trực tiếp của người xin; người chưa có quản lý thì
 * quản lý nghỉ phép duyệt. Không ai tự duyệt đơn của chính mình.
 */
export function canDecideLeave(
  viewer: { id: string; isLeaveManager: boolean },
  requester: { id: string; managerId: string | null; managerActive?: boolean }
) {
  if (requester.id === viewer.id) return false;
  const managerId = leaveManagerId(requester);
  return managerId ? managerId === viewer.id : viewer.isLeaveManager;
}

/** Danh sách người sẽ duyệt đơn của một người (để thông báo và hiển thị). */
export function leaveApproverIds(
  requester: { id: string; managerId: string | null; managerActive?: boolean },
  leaveManagerIds: string[]
) {
  const managerId = leaveManagerId(requester);
  return managerId
    ? [managerId]
    : leaveManagerIds.filter((id) => id !== requester.id);
}

/** Người xin tự huỷ được đơn đang chờ, hoặc đơn đã duyệt nhưng chưa tới ngày nghỉ. */
export function canCancelLeave(
  request: { status: string; startDate: Date },
  today = todayInVietnam()
) {
  if (request.status === "PENDING") return true;
  return request.status === "APPROVED" && request.startDate > today;
}

/** Quỹ phép năm: chỉ đơn nghỉ phép năm mới trừ quỹ. */
export function summarizeLeave(
  requests: Array<{ type: string; status: string; days: number }>,
  quota: number,
  adjustmentDays = 0
) {
  let used = 0;
  let pending = 0;
  for (const request of requests) {
    if (!leaveTypeInfo(request.type).deductsQuota) continue;
    if (request.status === "APPROVED") used += request.days;
    if (request.status === "PENDING") pending += request.days;
  }
  used = Math.max(0, used + adjustmentDays);
  return { quota, used, pending, remaining: quota - used };
}

export function formatLeaveDays(days: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(days);
}
