"use client";

import { useState } from "react";
import { splitEvenly, sumMonths } from "@/lib/kpi";

const MILLION = 1_000_000;
const MONTH_LABELS = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);

export type KpiGridRow = { id: string; name: string; hint?: string };

export function formatMillions(value: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(
    value / MILLION
  );
}

/**
 * Chuẩn hoá chuỗi đang gõ: chỉ giữ chữ số và một dấu phẩy thập phân, tự chèn
 * dấu chấm phân cách hàng nghìn ("1200000,5" → "1.200.000,5").
 */
export function formatAmountDraft(text: string) {
  const cleaned = text.replace(/[^\d,]/g, "");
  const commaIndex = cleaned.indexOf(",");
  const integerDigits = (
    commaIndex === -1 ? cleaned : cleaned.slice(0, commaIndex)
  ).replace(/^0+(?=\d)/, "");
  const grouped = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (commaIndex === -1) return grouped;
  const decimals = cleaned.slice(commaIndex + 1).replace(/,/g, "").slice(0, 3);
  return `${grouped || "0"},${decimals}`;
}

/**
 * Đọc số người dùng gõ theo đơn vị triệu đồng → VND. Dấu chấm là phân cách
 * hàng nghìn, dấu phẩy là thập phân ("1.200,5" = 1.200,5 triệu).
 */
export function parseMillions(text: string): number | null {
  const normalized = text.trim().replace(/[\s.]/g, "").replace(",", ".");
  if (!normalized) return 0;
  if (!/^\d*\.?\d*$/.test(normalized) || normalized === ".") return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * MILLION);
}

/** Ô nhập số tiền (triệu đồng): giữ nguyên chuỗi đang gõ cho tới khi rời ô. */
export function AmountInput({
  value,
  onChange,
  ariaLabel,
  disabled,
  className = "",
}: {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      value={draft ?? (value === 0 ? "" : formatMillions(value))}
      placeholder="0"
      onFocus={(event) => {
        setDraft(value === 0 ? "" : formatMillions(value));
        event.target.select();
      }}
      onChange={(event) => {
        const input = event.target;
        const formatted = formatAmountDraft(input.value);
        // Giữ con trỏ đúng chỗ sau khi chèn dấu chấm: đếm số ký tự có nghĩa
        // (chữ số, dấu phẩy) đứng trước con trỏ rồi tìm lại vị trí đó.
        const meaningfulBefore = input.value
          .slice(0, input.selectionStart ?? input.value.length)
          .replace(/[^\d,]/g, "").length;
        let caret = 0;
        for (let seen = 0; caret < formatted.length && seen < meaningfulBefore; caret += 1) {
          if (formatted[caret] !== ".") seen += 1;
        }
        setDraft(formatted);
        requestAnimationFrame(() => {
          if (document.activeElement === input) {
            input.setSelectionRange(caret, caret);
          }
        });
        const parsed = parseMillions(formatted);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => setDraft(null)}
      className={`h-9 w-full rounded-[6px] border border-zinc-200 bg-white px-2 text-right text-[13px] tabular-nums text-zinc-900 outline-none transition-colors placeholder:text-zinc-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-zinc-50 disabled:text-zinc-400 ${className}`}
    />
  );
}

/**
 * Lưới nhập chỉ tiêu 12 tháng cho nhiều dòng (team hoặc Account), đơn vị triệu đồng.
 * Gõ vào cột "Cả năm" sẽ chia đều cho 12 tháng; sau đó sửa từng tháng được.
 */
export default function KpiMonthGrid({
  rows,
  values,
  onChange,
  rowHeader,
  reference,
  disabled,
}: {
  rows: KpiGridRow[];
  values: Record<string, number[]>;
  onChange: (id: string, months: number[]) => void;
  rowHeader: string;
  /** Chỉ tiêu cấp trên để đối chiếu tổng đã chia theo từng tháng. */
  reference?: { label: string; months: number[] };
  disabled?: boolean;
}) {
  const totals = MONTH_LABELS.map((_, index) =>
    rows.reduce((sum, row) => sum + (values[row.id]?.[index] ?? 0), 0)
  );
  const grandTotal = sumMonths(totals);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-xs text-zinc-500">
            <th className="sticky left-0 z-10 w-44 bg-white px-3 py-2 text-left font-medium">
              {rowHeader}
            </th>
            <th className="w-28 px-1 py-2 text-right font-medium">Cả năm</th>
            {MONTH_LABELS.map((label) => (
              <th key={label} className="px-1 py-2 text-right font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const months = values[row.id] ?? [];
            return (
              <tr key={row.id}>
                <th className="sticky left-0 z-10 bg-white px-3 py-1 text-left font-medium text-zinc-800">
                  <span className="block truncate" title={row.name}>
                    {row.name}
                  </span>
                  {row.hint && (
                    <span className="block truncate text-[11px] font-normal text-zinc-400">
                      {row.hint}
                    </span>
                  )}
                </th>
                <td className="px-1 py-1">
                  <AmountInput
                    value={sumMonths(months)}
                    onChange={(total) => onChange(row.id, splitEvenly(total))}
                    ariaLabel={`${row.name} — cả năm (chia đều 12 tháng)`}
                    disabled={disabled}
                    className="border-zinc-300 bg-zinc-50 font-semibold"
                  />
                </td>
                {MONTH_LABELS.map((label, index) => (
                  <td key={label} className="px-1 py-1">
                    <AmountInput
                      value={months[index] ?? 0}
                      onChange={(amount) =>
                        onChange(
                          row.id,
                          MONTH_LABELS.map((_, i) =>
                            i === index ? amount : (months[i] ?? 0)
                          )
                        )
                      }
                      ariaLabel={`${row.name} — tháng ${index + 1}`}
                      disabled={disabled}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="text-[13px] tabular-nums">
          <tr className="text-zinc-700">
            <th className="sticky left-0 z-10 border-t border-zinc-100 bg-white px-3 py-2 text-left font-medium">
              {reference ? "Đã chia" : "Tổng"}
            </th>
            <td className="border-t border-zinc-100 px-3 py-2 text-right font-semibold">
              {formatMillions(grandTotal)}
            </td>
            {totals.map((total, index) => (
              <td
                key={index}
                className="border-t border-zinc-100 px-3 py-2 text-right"
              >
                {formatMillions(total)}
              </td>
            ))}
          </tr>
          {reference && (
            <>
              <tr className="text-zinc-500">
                <th className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left font-medium">
                  {reference.label}
                </th>
                <td className="px-3 py-1.5 text-right font-semibold">
                  {formatMillions(sumMonths(reference.months))}
                </td>
                {reference.months.map((amount, index) => (
                  <td key={index} className="px-3 py-1.5 text-right">
                    {formatMillions(amount)}
                  </td>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left font-medium text-zinc-500">
                  Còn lại
                </th>
                {[
                  sumMonths(reference.months) - grandTotal,
                  ...reference.months.map(
                    (amount, index) => amount - totals[index]
                  ),
                ].map((gap, index) => (
                  <td
                    key={index}
                    className={`px-3 py-1.5 text-right ${
                      index === 0 ? "font-semibold" : ""
                    } ${
                      gap === 0
                        ? "text-emerald-600"
                        : gap > 0
                          ? "text-amber-600"
                          : "text-red-600"
                    }`}
                  >
                    {formatMillions(gap)}
                  </td>
                ))}
              </tr>
            </>
          )}
        </tfoot>
      </table>
    </div>
  );
}
