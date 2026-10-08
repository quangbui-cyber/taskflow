// Quy tắc thuần của KPI doanh số: tách khỏi Prisma để test được.

export const KPI_TIME_ZONE = "Asia/Ho_Chi_Minh";
export const KPI_MONTHS = 12;
/** Trạng thái dự án được ghi nhận doanh số — khớp trang Doanh số. */
export const KPI_RECOGNIZED_STATUSES = ["ON_PROCESS", "DONE"];
// Trần cho một ô chỉ tiêu tháng, chặn số nhập nhầm làm tràn tổng.
const MAX_MONTH_AMOUNT = 1_000_000_000_000;

export function emptyMonths(): number[] {
  return Array.from({ length: KPI_MONTHS }, () => 0);
}

export function sumMonths(months: number[]) {
  return months.reduce((sum, value) => sum + value, 0);
}

export function addMonths(a: number[], b: number[]) {
  return a.map((value, index) => value + (b[index] ?? 0));
}

export function vietnamYearMonth(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KPI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return { year, month };
}

/** Khoảng thời gian [start, end) của một năm theo giờ Việt Nam (UTC+7, không DST). */
export function kpiYearRange(year: number) {
  const offsetMs = 7 * 60 * 60 * 1000;
  return {
    start: new Date(Date.UTC(year, 0, 1) - offsetMs),
    end: new Date(Date.UTC(year + 1, 0, 1) - offsetMs),
  };
}

export function isValidKpiYear(year: number) {
  return Number.isInteger(year) && year >= 2020 && year <= 2100;
}

/** Chia một tổng (VND, số nguyên) thành các phần nguyên gần đều nhau, cộng lại đúng bằng tổng. */
export function splitEvenly(total: number, parts = KPI_MONTHS): number[] {
  const safeTotal = Math.max(0, Math.round(total));
  const base = Math.floor(safeTotal / parts);
  const remainder = safeTotal - base * parts;
  return Array.from({ length: parts }, (_, index) =>
    index < remainder ? base + 1 : base
  );
}

/** Kiểm tra mảng 12 chỉ tiêu tháng gửi từ client; trả về null nếu không hợp lệ. */
export function parseMonthlyAmounts(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length !== KPI_MONTHS) return null;
  const months: number[] = [];
  for (const value of input) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (value < 0 || value > MAX_MONTH_AMOUNT) return null;
    months.push(Math.round(value));
  }
  return months;
}

/** % hoàn thành; null khi chưa có chỉ tiêu để so. */
export function progressPercent(actual: number, target: number) {
  if (target <= 0) return null;
  return Math.round((actual / target) * 100);
}

/**
 * Chỉ tiêu luỹ kế tính đến hết tháng hiện tại: năm đã qua tính đủ 12 tháng,
 * năm chưa tới bằng 0.
 */
export function targetToDate(months: number[], year: number, now = new Date()) {
  const current = vietnamYearMonth(now);
  if (year < current.year) return sumMonths(months);
  if (year > current.year) return 0;
  return sumMonths(months.slice(0, current.month));
}

type KpiViewer = { role: string; accountId: string | null };

/** Admin hoặc trưởng team mới được chia KPI team xuống Account. */
export function canAllocateTeamKpi(
  viewer: KpiViewer,
  team: { leaderId: string | null }
) {
  if (viewer.role === "ADMIN") return true;
  return (
    viewer.role === "ACCOUNT" &&
    viewer.accountId !== null &&
    team.leaderId === viewer.accountId
  );
}

/** Account chỉ xem được team của mình; Admin xem mọi team. */
export function canViewTeamKpi(
  viewer: KpiViewer & { teamId: string | null },
  teamId: string
) {
  if (viewer.role === "ADMIN") return true;
  return viewer.role === "ACCOUNT" && viewer.teamId === teamId;
}
