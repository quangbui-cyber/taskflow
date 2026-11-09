import { vnDateKey, vnDayStartFromKey } from "./dates";
import { TOUCHPOINT_KINDS } from "./labels";

export type TouchpointPrefill = {
  clientId?: string; opportunityId?: string | null; completeTaskId?: string | null; confirmDraftId?: string | null;
  occurredAt?: string; kind?: string; title?: string | null; nextDueDate?: string | null; assigneeId?: string | null;
};
export type TouchpointForm = {
  clientId: string; opportunityId: string | null; completeTaskId: string | null; confirmDraftId: string | null;
  kind: string; occurredAt: string; outcomeLevel: number | null; notes: string; openOpportunity: boolean;
  programTypeCode: string; periodMode: string; expectedYear: string; expectedPeriod: string; demandSignal: string;
  mode: "NEXT_STEP" | "WAIT"; nextTitle: string; assigneeId: string | null; nextDueDate: string; waitReason: string; waitReviewDate: string;
};
export const TOUCHPOINT_FIELD_ORDER = ["clientId", "opportunityId", "kind", "occurredAt", "outcomeLevel", "programTypeCode", "expectedPeriod", "demandSignal", "notes", "nextTitle", "assigneeId", "nextDueDate", "waitReason", "waitReviewDate"] as const;
export const TOUCHPOINT_FORM_MESSAGES = {
  outcome: "Chọn mức kết quả.", next: "Nhập việc cần làm và hạn, hoặc chọn Chờ khách.", wait: "Nhập lý do chờ và ngày xem lại.",
} as const;
export function emptyTouchpointForm(prefill: TouchpointPrefill = {}, todayKey: string): TouchpointForm {
  let occurredAt = todayKey;
  if (prefill.occurredAt) { const date = new Date(prefill.occurredAt); if (Number.isFinite(date.getTime())) occurredAt = vnDateKey(date); }
  return {
    clientId: prefill.clientId ?? "", opportunityId: prefill.opportunityId ?? null, completeTaskId: prefill.completeTaskId ?? null, confirmDraftId: prefill.confirmDraftId ?? null,
    kind: prefill.kind ?? "CALL", occurredAt, outcomeLevel: null, notes: "", openOpportunity: false,
    programTypeCode: "", periodMode: "MONTH", expectedYear: todayKey.slice(0, 4), expectedPeriod: "", demandSignal: "",
    mode: "NEXT_STEP", nextTitle: prefill.title ?? "", assigneeId: prefill.assigneeId ?? null, nextDueDate: prefill.nextDueDate ?? "", waitReason: "", waitReviewDate: "",
  };
}
function validDay(key: string) { try { vnDayStartFromKey(key); return true; } catch { return false; } }
export function validateTouchpointForm(s: TouchpointForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!s.clientId) errors.clientId = "Chọn khách hàng.";
  if (!TOUCHPOINT_KINDS.some(k => k.key === s.kind)) errors.kind = "Chọn loại điểm chạm.";
  if (!validDay(s.occurredAt)) errors.occurredAt = "Nhập ngày điểm chạm hợp lệ.";
  if (![1, 2, 3, 4].includes(s.outcomeLevel ?? 0)) errors.outcomeLevel = TOUCHPOINT_FORM_MESSAGES.outcome;
  if (s.notes.length > 2000) errors.notes = "Ghi chú tối đa 2000 ký tự.";
  if (s.outcomeLevel === 4 && !s.opportunityId && s.openOpportunity) {
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(s.programTypeCode)) errors.programTypeCode = "Chọn loại chương trình.";
    const period = Number(s.expectedPeriod); const year = Number(s.expectedYear);
    if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(period) || period < 1 || period > (s.periodMode === "QUARTER" ? 4 : 12) || !["MONTH", "QUARTER"].includes(s.periodMode)) errors.expectedPeriod = "Nhập tháng hoặc quý dự kiến.";
    if (!s.demandSignal.trim()) errors.demandSignal = "Nhập tín hiệu nhu cầu.";
    else if (s.demandSignal.trim().length > 2000) errors.demandSignal = "Tín hiệu nhu cầu tối đa 2000 ký tự.";
  }
  if (s.mode === "WAIT") {
    if (!s.waitReason.trim() || !s.waitReviewDate) errors.waitReason = TOUCHPOINT_FORM_MESSAGES.wait;
    if (s.waitReason.trim().length > 500) errors.waitReason = "Lý do chờ tối đa 500 ký tự.";
    if (s.waitReviewDate && !validDay(s.waitReviewDate)) errors.waitReviewDate = "Nhập ngày hợp lệ.";
  } else {
    if (!s.nextTitle.trim() || !s.nextDueDate) errors.nextTitle = TOUCHPOINT_FORM_MESSAGES.next;
    if (s.nextTitle.trim().length > 200) errors.nextTitle = "Việc cần làm tối đa 200 ký tự.";
    if (!s.assigneeId) errors.assigneeId = "Chọn người làm đang hoạt động.";
    if (s.nextDueDate && !validDay(s.nextDueDate)) errors.nextDueDate = "Nhập ngày hợp lệ.";
  }
  return errors;
}
export function buildTouchpointPayload(s: TouchpointForm, clientRequestId: string) {
  return {
    clientRequestId, clientId: s.clientId, opportunityId: s.opportunityId, kind: s.kind, occurredAt: vnDayStartFromKey(s.occurredAt), outcomeLevel: s.outcomeLevel, notes: s.notes.trim() || null,
    openOpportunity: s.outcomeLevel === 4 && !s.opportunityId && s.openOpportunity ? { programTypeCode: s.programTypeCode, expectedYear: Number(s.expectedYear), expectedMonth: s.periodMode === "MONTH" ? Number(s.expectedPeriod) : null, expectedQuarter: s.periodMode === "QUARTER" ? Number(s.expectedPeriod) : null, demandSignal: s.demandSignal.trim() } : null,
    next: s.mode === "WAIT" ? { mode: "WAIT" as const, reason: s.waitReason.trim(), reviewDate: vnDayStartFromKey(s.waitReviewDate) } : { mode: "NEXT_STEP" as const, title: s.nextTitle.trim(), assigneeId: s.assigneeId, dueDate: vnDayStartFromKey(s.nextDueDate) },
    completeTaskId: s.completeTaskId, confirmDraftId: s.confirmDraftId,
  };
}
