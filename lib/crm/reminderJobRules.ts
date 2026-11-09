import { vnDayStart } from "./dates";

export const REACH_TASK_KINDS = ["EVENT_REMINDER", "VERIFY_MONTH", "CADENCE", "PLAN_CLOSE", "NEXT_STEP", "APPOINTMENT", "WAIT", "WINBACK"] as const;
export const REVIEW_WINDOW_KINDS = REACH_TASK_KINDS;
export const STALE_DRAFT_DAYS = 7;
export const PLAN_CLOSE_LEAD_DAYS = 28;
export function overdueDays(dueDate: Date, now: Date): number {
  return Math.max(0, Math.round((vnDayStart(now).getTime() - vnDayStart(dueDate).getTime()) / 86400000));
}
export function shouldNotifyOverdue(days: number): boolean {
  return Number.isSafeInteger(days) && (days === 1 || days === 3 || (days >= 7 && days % 7 === 0));
}
export function planClosePeriod(budgetSeasonMonth: number | null, now: Date): { periodKey: string; dueDate: Date } | null {
  if (!Number.isInteger(budgetSeasonMonth) || budgetSeasonMonth === null || budgetSeasonMonth < 1 || budgetSeasonMonth > 12) return null;
  const today = vnDayStart(now);
  let year = new Date(today.getTime() + 7 * 3600000).getUTCFullYear();
  let dueDate = new Date(Date.UTC(year, budgetSeasonMonth - 1, 1) - 7 * 3600000);
  if (dueDate < today) { year++; dueDate = new Date(Date.UTC(year, budgetSeasonMonth - 1, 1) - 7 * 3600000); }
  return dueDate.getTime() - today.getTime() <= PLAN_CLOSE_LEAD_DAYS * 86400000 ? { periodKey: `plan-close:${year}`, dueDate } : null;
}
export function reminderTaskTitle(kind: "OFFSET" | "VERIFY_MONTH" | "CADENCE" | "PLAN_CLOSE", input: { clientName: string; programLabel?: string; offsetDays?: number | null }): string {
  if (kind === "VERIFY_MONTH") return `Xác minh tháng ${input.programLabel ?? "chương trình"} với ${input.clientName}`;
  if (kind === "CADENCE") return `Nhắc định kỳ: ${input.clientName}`;
  if (kind === "PLAN_CLOSE") return `Kỳ chốt kế hoạch: ${input.clientName}`;
  return `Tiếp cận ${input.clientName}: ${input.programLabel ?? "chương trình"} còn ${input.offsetDays ?? 0} ngày`;
}
export const dueMessage = (clientName: string, reason: string) => `Đến hạn tiếp cận ${clientName}: ${reason}.`;
export const overdueMessage = (clientName: string, days: number) => `${clientName} quá hạn tiếp cận ${days} ngày.`;
export const staleDraftMessage = (clientName: string, n: number) => `Có ${n} điểm chạm nháp của ${clientName} chờ xác nhận quá 7 ngày.`;
export const missingNextStepMessage = (clientName: string) => `${clientName} có Cơ hội đang mở nhưng chưa có bước tiếp theo.`;
export const crmDedupeKey = (parts: string[]) => `crm:${parts.join(":")}`;
