import type { ReviewItem, ReviewGroup } from "./review";
import type { TierValue, CadenceWeeks } from "./settingsSchema";
import { REVIEW_REASON_LABELS } from "./labels";
import { vnDateKey, vnDayStart, addDaysVn } from "./dates";
import { vietnamYearMonth } from "../kpi";

export type ReviewRawFilters = { team?: string | string[]; pic?: string | string[] };
export type ReviewFilters = { teamId: string | null; pic: "all" | "me" | string; key: string };
export function resolveReviewFilters(raw: ReviewRawFilters, ctx: { managedTeamIds: string[]; accountTeamId: string | null; accountId: string | null; teamIds: string[]; picAccountIds?: string[] }): ReviewFilters {
  const valid = (v: unknown): string | undefined => typeof v === "string" && v.length <= 64 ? v : undefined;
  const team = valid(raw.team); const pic = valid(raw.pic);
  const fallback = ctx.accountTeamId && ctx.teamIds.includes(ctx.accountTeamId) ? ctx.accountTeamId : ctx.managedTeamIds.find((id) => ctx.teamIds.includes(id)) ?? null;
  const teamId = team === "all" ? null : team && ctx.teamIds.includes(team) ? team : fallback;
  const selectedPic = pic === "me" ? ctx.accountId ? "me" : "all" : pic && ctx.picAccountIds?.includes(pic) ? pic : "all";
  return { teamId, pic: selectedPic, key: `${teamId ?? "all"}|${selectedPic}` };
}

export function clientInCare(c: { picAccountId: string | null; openOpportunityCount: number; activeEventCount: number; importStatus: string | null }): boolean {
  return c.picAccountId !== null || c.openOpportunityCount > 0 || c.activeEventCount > 0 || c.importStatus !== null;
}
type ReviewTask = { id: string; dueDate: Date | null; crmKind: string | null; escalatedAt: Date | null };
export function reviewReasonFor(task: Pick<ReviewTask, "crmKind" | "escalatedAt"> | null, planClose: boolean): keyof typeof REVIEW_REASON_LABELS {
  if (task?.escalatedAt) return "ESCALATED";
  if (!task) return planClose ? "PLAN_CLOSE" : "NEXT_STEP";
  return ["APPOINTMENT", "EVENT_REMINDER", "VERIFY_MONTH", "CADENCE", "WAIT", "NEXT_STEP"].includes(task.crmKind ?? "") ? task.crmKind as keyof typeof REVIEW_REASON_LABELS : "NEXT_STEP";
}
export function toReviewItem(input: { clientId: string; tier: TierValue; task: ReviewTask | null; budgetSeasonMonth: number | null }, now: Date): ReviewItem {
  const month = vietnamYearMonth(now).month;
  return { key: input.task?.id ?? `client:${input.clientId}`, clientId: input.clientId, tier: input.tier, dueDate: input.task?.dueDate ?? null, hasOpenNextStep: input.task !== null, appointment: input.task?.crmKind === "APPOINTMENT", planClose: input.budgetSeasonMonth === month || input.budgetSeasonMonth === month % 12 + 1, escalated: input.task?.escalatedAt != null };
}
export function reviewPrefill(input: { clientId: string; opportunityId: string | null; taskId: string | null; taskAssigneeId: string | null; picUserId: string | null; tier: TierValue; cadenceWeeks: CadenceWeeks }, now: Date): ReviewRow["prefill"] {
  return { clientId: input.clientId, opportunityId: input.opportunityId, completeTaskId: input.taskId, title: null, nextDueDate: vnDateKey(addDaysVn(vnDayStart(now), input.cadenceWeeks[input.tier] * 7)), assigneeId: input.taskAssigneeId ?? input.picUserId ?? null };
}

export type ReviewRow = {
  key: string; group: ReviewGroup;
  client: { id: string; name: string; version: number; tier: TierValue; buyingUnitName: string | null };
  reason: { key: keyof typeof REVIEW_REASON_LABELS; label: string; sourceLabel: string | null; sentence: string; lateDays: number | null };
  lastTouch: { date: Date; kindLabel: string; outcomeLabel: string | null } | null;
  opportunity: { id: string; name: string } | null;
  pic: { accountId: string; name: string; userId: string | null } | null;
  assignee: { id: string; name: string } | null; dueDate: Date | null; taskId: string | null;
  prefill: { clientId: string; opportunityId: string | null; completeTaskId: string | null; title: string | null; nextDueDate: string | null; assigneeId: string | null };
  can: { logResult: boolean; assign: boolean; postpone: boolean; escalate: boolean; assignPic: boolean };
};
export type UnratedRow = { clientId: string; name: string; revenue24m: number; version: number };
export type DraftRow = { id: string; clientId: string; clientName: string; opportunityId: string | null; occurredAt: Date; sourceLabel: "Họp TaskFlow" | "Biên bản họp" | "Nhập tracker"; title: string; canConfirm: boolean };
export type WeeklyReviewGroups = { week: { mondayKey: string; label: string; start: Date; end: Date }; filters: ReviewFilters; metrics: { overdue: number; dueThisWeek: number; noNextStep: number }; groups: Record<ReviewGroup, ReviewRow[]>; isEmpty: boolean };
export type WeeklyReview = WeeklyReviewGroups & { teams: { id: string; name: string }[]; pics: { accountId: string; name: string }[]; metrics: WeeklyReviewGroups["metrics"] & { drafts: number }; unrated: UnratedRow[]; potentialScaleConfigured: boolean; drafts: DraftRow[] };
