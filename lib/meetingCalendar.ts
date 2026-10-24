import { toDateInputVN } from "@/lib/dates";
import { vnDateTimeToUtc } from "@/lib/meetings";

// Mọi phép tính ngày ở đây dùng khoá "yyyy-MM-dd" theo giờ Việt Nam, không phụ thuộc múi giờ máy.
const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function keyToUtcMidnight(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function utcMidnightToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Cộng/trừ ngày trên khoá yyyy-MM-dd */
export function addDaysToKey(key: string, days: number): string {
  return utcMidnightToKey(keyToUtcMidnight(key) + days * DAY_MS);
}

/** Thứ trong tuần của khoá ngày: 0 = Thứ Hai … 6 = Chủ nhật */
export function weekdayIndexOfKey(key: string): number {
  return (new Date(keyToUtcMidnight(key)).getUTCDay() + 6) % 7;
}

/** Thứ Hai của tuần chứa ngày đã cho */
export function mondayOfKey(key: string): string {
  return addDaysToKey(key, -weekdayIndexOfKey(key));
}

/**
 * Tuần cần hiện trên lịch phòng: lấy từ tham số ?week= (ngày bất kỳ trong tuần),
 * sai định dạng thì về tuần hiện tại. Thứ Bảy, Chủ nhật mở sang tuần tới cho tiện đặt lịch.
 */
export function resolveCalendarWeek(param: string | undefined, now = new Date()): string {
  if (param && vnDateTimeToUtc(param, "00:00")) return mondayOfKey(param);
  const today = toDateInputVN(now);
  const monday = mondayOfKey(today);
  return weekdayIndexOfKey(today) >= 5 ? addDaysToKey(monday, 7) : monday;
}

/** Khoảng thời gian UTC của cả tuần (Thứ Hai 00:00 → Thứ Hai tuần sau 00:00, giờ VN) */
export function calendarWeekRange(mondayKey: string) {
  const start = vnDateTimeToUtc(mondayKey, "00:00")!;
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
}

/** Số phút tính từ 00:00 giờ VN của thời điểm đã cho */
export function vnMinuteOfDay(date: Date): number {
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  return vn.getUTCHours() * 60 + vn.getUTCMinutes();
}

/** "26/10 – 30/10/2026" */
export function formatWeekLabel(mondayKey: string, days: number): string {
  const [year, month, day] = mondayKey.split("-");
  const end = addDaysToKey(mondayKey, days - 1);
  const [endYear, endMonth, endDay] = end.split("-");
  const startLabel = year === endYear ? `${day}/${month}` : `${day}/${month}/${year}`;
  return `${startLabel} – ${endDay}/${endMonth}/${endYear}`;
}

/** "HH:mm" từ số phút trong ngày */
export function minuteToTime(minute: number): string {
  const clamped = Math.max(0, Math.min(minute, 23 * 60 + 30));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}
