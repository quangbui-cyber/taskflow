import { vnDay } from "./reminders";
import { mondayOfKey } from "../meetingCalendar";
export function nextCadenceDueDate(lastConfirmedAt: Date | null, clientCreatedAt: Date, cadenceWeeks: number): Date {
  if (!Number.isInteger(cadenceWeeks) || cadenceWeeks < 1 || cadenceWeeks > 104) throw new Error("Chu kỳ chăm sóc không hợp lệ.");
  return new Date(vnDay(lastConfirmedAt ?? clientCreatedAt).getTime() + cadenceWeeks * 7 * 86400000);
}
export function isCadenceDue(input: { lastConfirmedAt: Date | null; clientCreatedAt: Date; cadenceWeeks: number; hasOpenCrmTask: boolean; hasActiveEventStepInWindow: boolean; weekEnd: Date }): boolean {
  return !input.hasOpenCrmTask && !input.hasActiveEventStepInWindow && nextCadenceDueDate(input.lastConfirmedAt, input.clientCreatedAt, input.cadenceWeeks) < input.weekEnd;
}
export function cadencePeriodKey(dueDate: Date): string {
  const key = new Date(vnDay(dueDate).getTime() + 7 * 3600000).toISOString().slice(0, 10);
  return `cadence:${mondayOfKey(key)}`;
}
