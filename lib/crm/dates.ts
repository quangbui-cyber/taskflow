import { KPI_TIME_ZONE, vietnamYearMonth } from "../kpi";
import { mondayOfKey, calendarWeekRange, addDaysToKey } from "../meetingCalendar";
const DAY = 86400000;
export function vnDateKey(date: Date): string {
  const { year, month } = vietnamYearMonth(date);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: KPI_TIME_ZONE, day: "2-digit" }).format(date);
  return `${year}-${String(month).padStart(2, "0")}-${day}`;
}
export function vnDayStartFromKey(key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("Ngày không hợp lệ.");
  const date = new Date(`${key}T00:00:00+07:00`);
  if (!Number.isFinite(date.getTime()) || vnDateKey(date) !== key) throw new Error("Ngày không hợp lệ.");
  return date;
}
export function vnDayStart(date: Date): Date { return vnDayStartFromKey(vnDateKey(date)); }
export function addDaysVn(date: Date, n: number): Date { return new Date(date.getTime() + n * DAY); }
export function crmWeekRange(now: Date) {
  const mondayKey = mondayOfKey(vnDateKey(now));
  return { mondayKey, ...calendarWeekRange(mondayKey) };
}
export function formatCrmWeekLabel(mondayKey: string): string {
  vnDayStartFromKey(mondayKey);
  const thursday = new Date(`${addDaysToKey(mondayKey, 3)}T00:00:00Z`);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / DAY + 1) / 7);
  const [year, month, day] = mondayKey.split("-");
  const [endYear, endMonth, endDay] = addDaysToKey(mondayKey, 6).split("-");
  const start = year === endYear ? `${day}/${month}` : `${day}/${month}`;
  return `Tuần ${week} · ${start} - ${endDay}/${endMonth}/${endYear}`;
}
export function formatCrmDate(date: Date, now: Date): string {
  const [year, month, day] = vnDateKey(date).split("-");
  return `${day}/${month}${year === vnDateKey(now).slice(0, 4) ? "" : `/${year}`}`;
}
