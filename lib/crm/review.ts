import type { TierValue, ReviewPriorityKey } from "./settingsSchema";
import { crmWeekRange, vnDayStart } from "./dates";
import { compareTier } from "./tier";
export type ReviewItem = { key: string; clientId: string; tier: TierValue; dueDate: Date | null; hasOpenNextStep: boolean; appointment: boolean; planClose: boolean; escalated: boolean };
export type ReviewGroup = "OVERDUE" | "DUE_THIS_WEEK" | "NO_NEXT_STEP";
export function classifyReviewItem(item: ReviewItem, week: { start: Date; end: Date }, now: Date): ReviewGroup | null {
  if (item.dueDate && item.dueDate < vnDayStart(now)) return "OVERDUE";
  if (item.dueDate && item.dueDate >= week.start && item.dueDate < week.end) return "DUE_THIS_WEEK";
  if (!item.hasOpenNextStep) return "NO_NEXT_STEP";
  return null;
}
export function sortReviewGroup(items: ReviewItem[], priority: ReviewPriorityKey[]): ReviewItem[] {
  const flags = { APPOINTMENT: "appointment", PLAN_CLOSE: "planClose", ESCALATED: "escalated" } as const;
  return [...items].sort((a, b) => {
    for (const key of priority) {
      const difference = key === "TIER" ? compareTier(a.tier, b.tier) : Number(b[flags[key]]) - Number(a[flags[key]]);
      if (difference) return difference;
    }
    return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.key.localeCompare(b.key);
  });
}
export function buildReviewGroups(items: ReviewItem[], priority: ReviewPriorityKey[], now: Date): Record<ReviewGroup, ReviewItem[]> {
  const groups: Record<ReviewGroup, ReviewItem[]> = { OVERDUE: [], DUE_THIS_WEEK: [], NO_NEXT_STEP: [] };
  const week = crmWeekRange(now);
  for (const item of items) {
    const group = classifyReviewItem(item, week, now);
    if (group) groups[group].push(item);
  }
  for (const key of Object.keys(groups) as ReviewGroup[]) groups[key] = sortReviewGroup(groups[key], priority);
  return groups;
}
