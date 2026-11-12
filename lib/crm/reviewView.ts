import type { ReviewRow, WeeklyReview } from "./reviewData";
import type { ReviewGroup } from "./review";
import type { TierValue } from "./settingsSchema";
import { formatCrmDate, vnDateKey, vnDayStart } from "./dates";

const DAY = 86400000;
export function draftsOpenFrom(searchParams: Record<string, string | string[] | undefined>): boolean {
  return searchParams.drafts === "open";
}
export type ReviewPrimary = "LOG_RESULT" | "SET_NEXT_STEP" | "ASSIGN_PIC" | null;
export type ReviewRowActions = { primary: ReviewPrimary; secondary: ("ASSIGN" | "POSTPONE")[]; menu: "ESCALATE"[] };
/** Assign and postpone are shown directly; asking AD/AM stays in the menu and only appears with permission. */
export function rowActionsFor(group: ReviewRow["group"], row: Pick<ReviewRow, "pic" | "taskId" | "can" | "campaignTask"> & { reason?: { key: string } }): ReviewRowActions {
  const { can } = row;
  const secondary: ReviewRowActions["secondary"] = [];
  const menu: ReviewRowActions["menu"] = [];
  if (!row.pic && !(row.campaignTask && row.taskId && can.logResult)) return { primary: can.assignPic ? "ASSIGN_PIC" : null, secondary, menu };
  if (group !== "NO_NEXT_STEP" && can.assign && row.taskId) secondary.push("ASSIGN");
  if (can.postpone && row.taskId) secondary.push("POSTPONE");
  if (can.escalate && row.taskId && row.reason?.key !== "ESCALATED") menu.push("ESCALATE");
  return { primary: can.logResult ? group === "NO_NEXT_STEP" ? "SET_NEXT_STEP" : "LOG_RESULT" : null, secondary, menu };
}
export function reviewPrimaryLabel(primary: ReviewPrimary): string | null {
  return primary === "LOG_RESULT" ? "Ghi kết quả" : primary === "SET_NEXT_STEP" ? "Đặt việc tiếp theo" : primary === "ASSIGN_PIC" ? "Giao PIC" : null;
}
function dayDiff(from: Date, to: Date): number {
  return Math.round((vnDayStart(to).getTime() - vnDayStart(from).getTime()) / DAY);
}
export function lateLabel(dueDate: Date | null, now: Date): string | null {
  if (!dueDate) return null;
  const days = dayDiff(dueDate, now);
  return days > 0 ? `Trễ ${days} ngày` : null;
}
export const REVIEW_DONE_LABELS = { LOGGED: "Đã ghi", ASSIGNED: "Đã giao", POSTPONED: "Đã hoãn" } as const;

export type ReviewFilterKey = ReviewGroup | "UNRATED" | "DRAFTS";
export function reviewFilterChips(counts: WeeklyReview["metrics"] & { unrated: number }): { key: ReviewFilterKey; label: string; count: number; warning: boolean }[] {
  return [
    { key: "OVERDUE", label: "Quá hạn", count: counts.overdue, warning: counts.overdue > 0 },
    { key: "DUE_THIS_WEEK", label: "Trong tuần", count: counts.dueThisWeek, warning: false },
    { key: "NO_NEXT_STEP", label: "Chưa có việc tiếp theo", count: counts.noNextStep, warning: false },
    { key: "UNRATED", label: "Chưa xếp hạng", count: counts.unrated, warning: false },
    { key: "DRAFTS", label: "Nháp chờ xác nhận", count: counts.drafts, warning: false },
  ];
}
const ALL_GROUPS: ReviewGroup[] = ["OVERDUE", "DUE_THIS_WEEK", "NO_NEXT_STEP"];
/** Filtering runs on the loaded snapshot only; it never refetches or drops handled rows. */
export function reviewFilterVisibility(filter: ReviewFilterKey | null): { groups: ReviewGroup[]; unrated: boolean; drafts: boolean } {
  if (filter === null) return { groups: [...ALL_GROUPS], unrated: true, drafts: true };
  if (filter === "UNRATED") return { groups: [], unrated: true, drafts: false };
  if (filter === "DRAFTS") return { groups: [], unrated: false, drafts: true };
  return { groups: [filter], unrated: false, drafts: false };
}
export function nextReviewFilter(current: ReviewFilterKey | null, clicked: ReviewFilterKey): ReviewFilterKey | null {
  return current === clicked ? null : clicked;
}

const lowerFirst = (text: string) => text ? text[0].toLocaleLowerCase("vi") + text.slice(1) : text;
export function cadenceLabel(tier: TierValue, weeks: number): string {
  return `Chu kỳ ${tier === "UNRATED" ? "khách chưa xếp hạng" : `hạng ${tier}`}: ${weeks} tuần`;
}
export function dueLabel(dueDate: Date, now: Date): { label: string; tone: "late" | "warn" | null } {
  const days = dayDiff(dueDate, now);
  if (days > 0) return { label: `Trễ ${days} ngày`, tone: "late" };
  if (days === 0) return { label: "Hạn hôm nay", tone: "warn" };
  return { label: `Hạn ${formatCrmDate(dueDate, now)}`, tone: null };
}
type SentenceRow = Pick<ReviewRow, "group" | "taskId" | "dueDate" | "client" | "reason" | "lastTouch">;
export type ReviewSentence = { todo: string; todoMuted: boolean; lateLabel: string | null; lateTone: "late" | "warn" | null; why: string | null; lastTouch: string | null };
/** One readable line per row: what to do, how late, why, and the previous contact. */
export function reviewRowSentence(row: SentenceRow, now: Date, cadenceWeeks: Record<TierValue, number>): ReviewSentence {
  const lastTouch = row.lastTouch
    ? `Lần trước ${formatCrmDate(row.lastTouch.date, now)}: ${lowerFirst(row.lastTouch.kindLabel)}${row.lastTouch.outcomeLabel ? `, ${lowerFirst(row.lastTouch.outcomeLabel)}` : ""}`
    : null;
  if (row.group === "NO_NEXT_STEP" && !row.taskId) {
    const weeks = cadenceWeeks[row.client.tier];
    const parts = [...(row.reason.key !== "NEXT_STEP" && row.reason.key !== "CADENCE" ? [row.reason.label] : []), cadenceLabel(row.client.tier, weeks)];
    let late: string | null = null, tone: ReviewSentence["lateTone"] = null;
    if (!row.lastTouch) { late = "Chưa có liên hệ đã xác nhận"; tone = "warn"; }
    else {
      const since = Math.floor(dayDiff(row.lastTouch.date, now) / 7);
      if (since >= weeks) { late = `Đã ${since} tuần chưa liên hệ`; tone = "warn"; }
    }
    return { todo: "Chưa có việc tiếp theo", todoMuted: true, lateLabel: late, lateTone: tone, why: parts.join(" · "), lastTouch };
  }
  const due = row.dueDate ? dueLabel(row.dueDate, now) : null;
  const reason = row.reason.key === "NEXT_STEP" ? "Việc tiếp theo đã hẹn" : row.reason.label;
  return {
    todo: row.reason.sentence, todoMuted: false, lateLabel: due?.label ?? null, lateTone: due?.tone ?? null,
    why: row.reason.sourceLabel ? `${reason} (${lowerFirst(row.reason.sourceLabel)})` : reason, lastTouch,
  };
}

// ---- crm51: two lanes and one week progress bar (sketch 006 screen 1) ----
type LaneItem = { dueDate: Date | null };
type LaneGroups<T extends LaneItem> = Record<ReviewGroup, T[]>;
function dueToday(row: LaneItem, now: Date): boolean {
  return !!row.dueDate && vnDateKey(row.dueDate) === vnDateKey(now);
}
/** "Cần làm trước" = overdue plus due today; "Trong tuần" = the rest of this week. Group order is kept. */
export function reviewLanes<T extends LaneItem>(groups: LaneGroups<T>, now: Date): { first: T[]; week: T[] } {
  return {
    first: [...groups.OVERDUE, ...groups.DUE_THIS_WEEK.filter(row => dueToday(row, now))],
    week: groups.DUE_THIS_WEEK.filter(row => !dueToday(row, now)),
  };
}
export type WeekSegmentKey = "late" | "today" | "rest" | "done";
export const WEEK_SEGMENT_LABELS: Record<WeekSegmentKey, string> = { late: "Trễ", today: "Hôm nay", rest: "Còn lại", done: "Xong" };
/** Done = CRM tasks finished this Vietnam week in the same scope; counted by the loader, not inferred here. */
export function reviewWeekProgress(groups: LaneGroups<LaneItem>, doneThisWeek: number, now: Date) {
  const lanes = reviewLanes(groups, now);
  const counts = { late: groups.OVERDUE.length, today: lanes.first.length - groups.OVERDUE.length, rest: lanes.week.length, done: Math.max(0, doneThisWeek) };
  const total = counts.late + counts.today + counts.rest + counts.done;
  const segments = (Object.keys(WEEK_SEGMENT_LABELS) as WeekSegmentKey[]).map(key => ({ key, label: WEEK_SEGMENT_LABELS[key], count: counts[key], percent: total ? counts[key] / total * 100 : 0 }));
  return { counts, total, segments, label: `${counts.done}/${total}` };
}
