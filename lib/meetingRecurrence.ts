// Quy tắc thuần của lịch họp lặp lại: sinh danh sách ngày từ cấu hình lặp.
// Ngày là chuỗi yyyy-MM-dd (theo giờ Việt Nam); không phụ thuộc Prisma để test được.

export const RECURRENCE_FREQUENCIES = [
  { key: "daily", label: "Hàng ngày (T2 – T6)", short: "Hàng ngày" },
  { key: "weekly", label: "Hàng tuần", short: "Hàng tuần" },
  { key: "biweekly", label: "Hai tuần một lần", short: "Hai tuần một lần" },
  { key: "monthly", label: "Hàng tháng", short: "Hàng tháng" },
] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number]["key"];

/** Một chuỗi họp tối đa bao nhiêu buổi, và kéo dài tối đa bao nhiêu ngày. */
export const MAX_SERIES_MEETINGS = 52;
export const MAX_SERIES_SPAN_DAYS = 366;

/** Thứ trong tuần theo kiểu T2 = 0 … CN = 6. */
export const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  /** Các thứ lặp lại (T2 = 0), chỉ dùng cho hàng tuần và hai tuần một lần. */
  weekdays: number[];
  end: { type: "count"; count: number } | { type: "date"; until: string };
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function isRecurrenceFrequency(value: string): value is RecurrenceFrequency {
  return RECURRENCE_FREQUENCIES.some((item) => item.key === value);
}

export function recurrenceLabel(frequency: string | null | undefined) {
  return RECURRENCE_FREQUENCIES.find((item) => item.key === frequency)?.short ?? null;
}

function parseDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return time;
}

function formatDay(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

/** T2 = 0 … CN = 6. */
function weekdayOf(time: number) {
  return (new Date(time).getUTCDay() + 6) % 7;
}

/**
 * Các ngày họp của chuỗi, từ ngày bắt đầu trở đi (ngày đầu tiên khớp quy tắc).
 * Trả về lỗi bằng tiếng Việt nếu cấu hình không hợp lệ hoặc quá giới hạn.
 */
export function expandRecurrence(
  startDate: string,
  rule: RecurrenceRule
): { dates: string[] } | { error: string } {
  const start = parseDay(startDate);
  if (start === null) return { error: "Hãy chọn ngày họp hợp lệ." };

  let limit = MAX_SERIES_MEETINGS;
  let untilTime = start + MAX_SERIES_SPAN_DAYS * DAY_MS;
  if (rule.end.type === "count") {
    if (
      !Number.isInteger(rule.end.count) ||
      rule.end.count < 2 ||
      rule.end.count > MAX_SERIES_MEETINGS
    ) {
      return { error: `Số buổi lặp lại phải từ 2 đến ${MAX_SERIES_MEETINGS}.` };
    }
    limit = rule.end.count;
  } else {
    const until = parseDay(rule.end.until);
    if (until === null || until < start) {
      return { error: "Ngày kết thúc lặp lại phải từ ngày họp đầu tiên trở đi." };
    }
    if (until > start + MAX_SERIES_SPAN_DAYS * DAY_MS) {
      return { error: "Lịch lặp lại chỉ kéo dài tối đa 1 năm." };
    }
    untilTime = until;
  }

  const weekdays =
    rule.frequency === "weekly" || rule.frequency === "biweekly"
      ? [...new Set(rule.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [];
  if ((rule.frequency === "weekly" || rule.frequency === "biweekly") && weekdays.length === 0) {
    weekdays.push(weekdayOf(start));
  }
  const startWeekMonday = start - weekdayOf(start) * DAY_MS;
  const startDayOfMonth = new Date(start).getUTCDate();

  const dates: string[] = [];
  const hardStop = start + MAX_SERIES_SPAN_DAYS * DAY_MS;
  for (let time = start; time <= hardStop && dates.length < limit; time += DAY_MS) {
    if (rule.end.type === "date" && time > untilTime) break;
    let matches = false;
    if (rule.frequency === "daily") {
      matches = weekdayOf(time) < 5;
    } else if (rule.frequency === "weekly") {
      matches = weekdays.includes(weekdayOf(time));
    } else if (rule.frequency === "biweekly") {
      const weeks = Math.round((time - weekdayOf(time) * DAY_MS - startWeekMonday) / (7 * DAY_MS));
      matches = weeks % 2 === 0 && weekdays.includes(weekdayOf(time));
    } else {
      matches = new Date(time).getUTCDate() === startDayOfMonth;
    }
    if (matches) dates.push(formatDay(time));
  }

  if (dates.length < 2) {
    return { error: "Lịch lặp lại cần có ít nhất 2 buổi họp." };
  }
  if (rule.end.type === "date" && dates.length >= MAX_SERIES_MEETINGS) {
    const next = dates[dates.length - 1];
    if (parseDay(next)! < untilTime) {
      return { error: `Một chuỗi họp tối đa ${MAX_SERIES_MEETINGS} buổi. Hãy rút ngắn ngày kết thúc.` };
    }
  }
  return { dates };
}

/** Đọc cấu hình lặp từ form; null = không lặp, lỗi nếu dữ liệu sai. */
export function parseRecurrenceForm(
  get: (name: string) => string,
  getAll: (name: string) => string[]
): RecurrenceRule | null | { error: string } {
  const frequency = get("repeat");
  if (!frequency || frequency === "none") return null;
  if (!isRecurrenceFrequency(frequency)) return { error: "Kiểu lặp lại không hợp lệ." };

  const weekdays = getAll("repeatDays")
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  if (get("repeatEnd") === "date") {
    return { frequency, weekdays, end: { type: "date", until: get("repeatUntil") } };
  }
  return { frequency, weekdays, end: { type: "count", count: Number(get("repeatCount")) } };
}
