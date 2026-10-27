// Sinh nhật: chỉ lưu ngày/tháng (năm cố định BIRTHDAY_STORAGE_YEAR) để không
// thu thập năm sinh. Mọi phép tính "hôm nay" theo giờ Việt Nam.

/** Năm nhuận để 29/02 vẫn lưu được. */
export const BIRTHDAY_STORAGE_YEAR = 2000;
/** Khung "Sinh nhật sắp tới" trên trang chủ. */
export const UPCOMING_BIRTHDAY_DAYS = 30;
/** Vẫn gửi lời chúc được trong vài ngày sau sinh nhật (lỡ ngày vẫn chúc kịp). */
export const BIRTHDAY_WISH_GRACE_DAYS = 3;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type MonthDay = { month: number; day: number };

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidMonthDay(month: number, day: number) {
  return (
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(BIRTHDAY_STORAGE_YEAR, month)
  );
}

/** Ngày hôm nay theo giờ Việt Nam, dạng ngày UTC 00:00 để cộng trừ ngày cho gọn. */
export function vietnamToday(now = new Date()) {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  return Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate());
}

/** Thời điểm bắt đầu (UTC thật) của một ngày Việt Nam biểu diễn bằng ngày UTC 00:00. */
export function vietnamDayStart(dayUtc: number) {
  return new Date(dayUtc - VN_OFFSET_MS);
}

export function birthdayMonthDay(birthday: Date): MonthDay {
  return { month: birthday.getUTCMonth() + 1, day: birthday.getUTCDate() };
}

/** Ngày sinh nhật rơi vào năm `year`; 29/02 năm không nhuận tính là 28/02. */
function occurrenceInYear({ month, day }: MonthDay, year: number) {
  return Date.UTC(year, month - 1, Math.min(day, daysInMonth(year, month)));
}

/** Số ngày còn lại tới lần sinh nhật kế tiếp (0 = hôm nay). */
export function daysUntilBirthday(birthday: Date, now = new Date()) {
  const today = vietnamToday(now);
  const year = new Date(today).getUTCFullYear();
  const md = birthdayMonthDay(birthday);
  let next = occurrenceInYear(md, year);
  if (next < today) next = occurrenceInYear(md, year + 1);
  return Math.round((next - today) / DAY_MS);
}

/** Lần sinh nhật gần nhất đã tới (tính cả hôm nay), dạng ngày UTC 00:00. */
export function latestBirthdayOccurrence(birthday: Date, now = new Date()) {
  const today = vietnamToday(now);
  const year = new Date(today).getUTCFullYear();
  const md = birthdayMonthDay(birthday);
  const thisYear = occurrenceInYear(md, year);
  return thisYear <= today ? thisYear : occurrenceInYear(md, year - 1);
}

/** Số ngày kể từ lần sinh nhật gần nhất (0 = hôm nay). */
export function daysSinceBirthday(birthday: Date, now = new Date()) {
  return Math.round(
    (vietnamToday(now) - latestBirthdayOccurrence(birthday, now)) / DAY_MS
  );
}

export function canWishBirthday(birthday: Date | null | undefined, now = new Date()) {
  return !!birthday && daysSinceBirthday(birthday, now) <= BIRTHDAY_WISH_GRACE_DAYS;
}

export type UpcomingBirthday<T> = T & {
  daysUntil: number;
  /** Ngày sinh nhật kế tiếp (ngày UTC 00:00) để hiển thị thứ/ngày. */
  nextDate: Date;
};

/** Người có sinh nhật trong `days` ngày tới (tính cả hôm nay), gần nhất trước. */
export function upcomingBirthdays<T extends { birthday: Date | null; name: string }>(
  users: T[],
  now = new Date(),
  days = UPCOMING_BIRTHDAY_DAYS
): UpcomingBirthday<T>[] {
  const today = vietnamToday(now);
  return users
    .flatMap((user) => {
      if (!user.birthday) return [];
      const daysUntil = daysUntilBirthday(user.birthday, now);
      if (daysUntil >= days) return [];
      return [{ ...user, daysUntil, nextDate: new Date(today + daysUntil * DAY_MS) }];
    })
    .sort(
      (a, b) =>
        a.daysUntil - b.daysUntil || a.name.localeCompare(b.name, "vi")
    );
}

/** Đọc ngày/tháng từ form; chuỗi rỗng ở cả hai ô = xoá ngày sinh. */
export function parseBirthdayInput(
  dayValue: FormDataEntryValue | null,
  monthValue: FormDataEntryValue | null
): { birthday: Date | null } | { error: string } {
  const dayText = String(dayValue ?? "").trim();
  const monthText = String(monthValue ?? "").trim();
  if (!dayText && !monthText) return { birthday: null };
  if (!dayText || !monthText) {
    return { error: "Hãy chọn đủ cả ngày và tháng sinh." };
  }
  const day = Number(dayText);
  const month = Number(monthText);
  if (!isValidMonthDay(month, day)) {
    return { error: "Ngày sinh không hợp lệ." };
  }
  return { birthday: new Date(Date.UTC(BIRTHDAY_STORAGE_YEAR, month - 1, day)) };
}

const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** "27/10" */
export function formatBirthdayShort(date: Date) {
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`;
}

/** "Thứ Sáu, 30/10" cho một ngày UTC 00:00. */
export function formatBirthdayWithWeekday(date: Date) {
  return `${WEEKDAYS[date.getUTCDay()]}, ${formatBirthdayShort(date)}`;
}

export function birthdayCountdownLabel(daysUntil: number) {
  if (daysUntil === 0) return "Hôm nay";
  if (daysUntil === 1) return "Ngày mai";
  return `còn ${daysUntil} ngày`;
}

export function defaultBirthdayWish(name: string) {
  return `Chúc mừng sinh nhật ${name}! Chúc bạn tuổi mới thật nhiều sức khỏe, niềm vui và luôn rực rỡ cùng Creative Station.`;
}
