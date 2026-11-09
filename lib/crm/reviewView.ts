import type { ReviewRow, WeeklyReview } from "./reviewData";
import { vnDayStart } from "./dates";

export function draftsOpenFrom(searchParams: Record<string, string | string[] | undefined>): boolean {
  return searchParams.drafts === "open";
}
export function rowActionsFor(group: ReviewRow["group"], row: Pick<ReviewRow, "pic" | "taskId" | "can">) {
  const { can } = row;
  type Primary = "LOG_RESULT" | "SET_NEXT_STEP" | "ASSIGN_PIC" | null;
  const menu: ("ASSIGN" | "POSTPONE" | "ESCALATE")[] = [];
  if (!row.pic) return { primary: (can.assignPic ? "ASSIGN_PIC" : null) as Primary, menu };
  if (group !== "NO_NEXT_STEP" && can.assign && row.taskId) menu.push("ASSIGN");
  if (can.postpone && row.taskId) menu.push("POSTPONE");
  if (can.escalate && row.taskId) menu.push("ESCALATE");
  return { primary: (can.logResult ? group === "NO_NEXT_STEP" ? "SET_NEXT_STEP" : "LOG_RESULT" : null) as Primary, menu };
}
export function lateLabel(dueDate: Date | null, now: Date): string | null {
  if (!dueDate) return null;
  const days = Math.floor((vnDayStart(now).getTime() - vnDayStart(dueDate).getTime()) / 86400000);
  return days > 0 ? `Trễ ${days} ngày` : null;
}
export const REVIEW_DONE_LABELS = { LOGGED: "Đã ghi", ASSIGNED: "Đã giao", POSTPONED: "Đã hoãn" } as const;
export function reviewTiles(counts: WeeklyReview["metrics"]) {
  return [
    { label: "Quá hạn", count: counts.overdue, anchor: "crm-group-overdue", warning: counts.overdue > 0 },
    { label: "Đến hạn tuần này", count: counts.dueThisWeek, anchor: "crm-group-due", warning: false },
    { label: "Chưa có bước tiếp theo", count: counts.noNextStep, anchor: "crm-group-no-next", warning: false },
    { label: "Nháp chờ xác nhận", count: counts.drafts, anchor: "crm-drafts", warning: false },
  ];
}
