import { vnDayStart } from "./dates";

const compactNumber = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
const wholeNumber = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
function moneyParts(value: number): [string, string] {
  if (value >= 1e9) return [compactNumber.format(value / 1e9), "tỷ"];
  if (value >= 1e6) return [compactNumber.format(value / 1e6), "triệu"];
  return [wholeNumber.format(value), ""];
}
export function formatCompactVnd(value: number): string {
  return moneyParts(value).filter(Boolean).join(" ");
}
export function formatBudgetRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min === null) return `Đến ${formatCompactVnd(max!)}`;
  if (max === null) return `Từ ${formatCompactVnd(min)}`;
  const [low, lowUnit] = moneyParts(min);
  const [high, highUnit] = moneyParts(max);
  return lowUnit === highUnit
    ? `${low} - ${high}${highUnit ? ` ${highUnit}` : ""}`
    : `${formatCompactVnd(min)} - ${formatCompactVnd(max)}`;
}
export function formatExpectedTiming(value: { expectedYear: number; expectedMonth?: number | null; expectedQuarter?: number | null }): string {
  if (value.expectedMonth) return `${value.expectedMonth}/${value.expectedYear}`;
  if (value.expectedQuarter) return `Q${value.expectedQuarter}/${value.expectedYear}`;
  return String(value.expectedYear);
}
export function daysInStage(since: Date, now: Date): number {
  return Math.max(0, Math.round((vnDayStart(now).getTime() - vnDayStart(since).getTime()) / 86_400_000));
}
export function formatThousandsInput(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
export function parseThousandsInput(text: string): number | null {
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(text)) return null;
  const value = Number(text.replace(/\./g, ""));
  return Number.isSafeInteger(value) ? value : null;
}
