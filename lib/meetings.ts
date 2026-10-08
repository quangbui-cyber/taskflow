import { formatDateVN, formatHour, toDateInputVN } from "@/lib/dates";

export const MEETING_RESPONSES = [
  { key: "PENDING", label: "Chưa phản hồi" },
  { key: "ACCEPTED", label: "Tham dự" },
  { key: "DECLINED", label: "Từ chối" },
] as const;

export type MeetingResponse = (typeof MEETING_RESPONSES)[number]["key"];

export const MEETING_TITLE_MAX = 120;
export const MEETING_DESCRIPTION_MAX = 2000;
export const MEETING_MAX_ATTENDEES = 100;

// Việt Nam luôn ở UTC+7 — xem ghi chú trong lib/dates.ts.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

/** Giờ họp chỉ nhận mốc tròn giờ hoặc 30 phút: 00:00, 00:30, … 23:30 */
export const MEETING_TIME_SLOTS = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  return `${hour}:${index % 2 === 0 ? "00" : "30"}`;
});

export function isMeetingTimeSlot(time: string): boolean {
  return /^([01]\d|2[0-3]):(00|30)$/.test(time);
}

export function meetingResponseLabel(key: string) {
  return (
    MEETING_RESPONSES.find((response) => response.key === key)?.label ??
    MEETING_RESPONSES[0].label
  );
}

/** Ghép ngày (yyyy-MM-dd) và giờ (HH:mm) theo giờ Việt Nam thành thời điểm UTC; null nếu sai định dạng */
export function vnDateTimeToUtc(date: string, time: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hour, minute] = timeMatch.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;

  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(utc);
  // Date.UTC tự "tràn" ngày không tồn tại (31/02 → 03/03) nên phải so lại.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return new Date(utc - VN_OFFSET_MS);
}

/** Hai khoảng [start, end) có giao nhau không — họp kết thúc 10:00 không trùng với họp bắt đầu 10:00 */
export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Thứ trong tuần theo giờ VN, ví dụ "Thứ Tư" */
export function weekdayVN(date: Date): string {
  return WEEKDAYS[new Date(date.getTime() + VN_OFFSET_MS).getUTCDay()];
}

/** "09:00 – 10:30" */
export function formatMeetingTime(startAt: Date, endAt: Date): string {
  return `${formatHour(startAt)} – ${formatHour(endAt)}`;
}

/** "Thứ Tư, 07/10/2026" kèm "Hôm nay"/"Ngày mai" khi phù hợp */
export function formatMeetingDay(date: Date, now = new Date()): string {
  const label = `${weekdayVN(date)}, ${formatDateVN(date)}`;
  const dayKey = toDateInputVN(date);
  if (dayKey === toDateInputVN(now)) return `Hôm nay · ${label}`;
  if (dayKey === toDateInputVN(new Date(now.getTime() + 24 * 60 * 60 * 1000))) {
    return `Ngày mai · ${label}`;
  }
  return label;
}

/** "09:00 – 10:30, Thứ Tư, 07/10/2026" — dùng trong thông báo và email */
export function formatMeetingWhen(startAt: Date, endAt: Date): string {
  return `${formatMeetingTime(startAt, endAt)}, ${weekdayVN(startAt)}, ${formatDateVN(startAt)}`;
}

/** Khoảng thời gian của một ngày (theo giờ VN) chứa thời điểm đã cho */
export function vnDayRange(date = new Date()) {
  const start = vnDateTimeToUtc(toDateInputVN(date), "00:00")!;
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}
