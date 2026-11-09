import { vnDateKey, vnDayStartFromKey } from "./dates";
import { EVENT_SOURCES } from "./labels";
import { planReminderSteps, type EventTiming } from "./reminders";

export type ExpectedEventFormState = {
  programTypeCode: string; buyingUnitId: string; precision: "DAY" | "MONTH" | "QUARTER";
  dateKey: string; month: string; quarter: string; year: string; source: string; note: string;
};
export type ExpectedEventValue = EventTiming & { programTypeCode: string; buyingUnitId: string | null; source: "CLIENT_CONFIRMED" | "HISTORY" | "INDUSTRY_SEASON"; note: string | null };
export function validateExpectedEventForm(state: ExpectedEventFormState, nowYear: number): { ok: true; value: ExpectedEventValue } | { errors: Partial<Record<"programTypeCode" | "time" | "source" | "note", string>> } {
  const errors: Partial<Record<"programTypeCode" | "time" | "source" | "note", string>> = {};
  if (!state.programTypeCode.trim()) errors.programTypeCode = "Chọn loại chương trình.";
  if (!EVENT_SOURCES.some(s => s.key === state.source)) errors.source = "Chọn nguồn.";
  if (state.note.trim().length > 1000) errors.note = "Ghi chú tối đa 1000 ký tự.";
  let date: Date | null = null; let month: number | null = null; let quarter: number | null = null;
  let year = /^\d{4}$/.test(state.year) ? Number(state.year) : NaN;
  if (state.precision === "DAY") {
    try { date = vnDayStartFromKey(state.dateKey); year = Number(vnDateKey(date).slice(0, 4)); month = Number(vnDateKey(date).slice(5, 7)); }
    catch { errors.time = "Nhập thời gian dự kiến."; }
  } else if (state.precision === "MONTH") {
    month = /^\d{1,2}$/.test(state.month) ? Number(state.month) : null;
    if (!month || month < 1 || month > 12) errors.time = "Nhập thời gian dự kiến.";
  } else if (state.precision === "QUARTER") {
    quarter = /^[1-4]$/.test(state.quarter) ? Number(state.quarter) : null;
    if (!quarter) errors.time = "Nhập thời gian dự kiến.";
  } else errors.time = "Nhập thời gian dự kiến.";
  if (!Number.isInteger(year) || year < nowYear - 1 || year > nowYear + 3) errors.time = "Nhập thời gian dự kiến.";
  if (Object.keys(errors).length) return { errors };
  return { ok: true, value: { programTypeCode: state.programTypeCode.trim(), buyingUnitId: state.buyingUnitId || null, precision: state.precision, year, month, quarter, date, source: state.source as ExpectedEventValue["source"], note: state.note.trim() || null } };
}
export function previewReminderSteps(value: EventTiming & { programTypeCode: string }, offsets: Record<string, number[]>, today: Date) {
  return planReminderSteps(value, offsets[value.programTypeCode] ?? [], today).map(step => ({ ...step, label: step.kind === "VERIFY_MONTH" ? "Xác minh tháng" : `${step.offsetDays} ngày trước` }));
}
export function expectedEventToast(mode: "create" | "update", n: number): string {
  return mode === "create" ? `Đã lưu sự kiện và tạo ${n} mốc nhắc.` : `Đã cập nhật ngày, ${n} mốc chưa làm được tính lại.`;
}
