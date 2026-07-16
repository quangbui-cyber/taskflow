"use client";

import { useEffect, useRef } from "react";
import { formatVND } from "@/lib/types";

export type MonthlyRevenuePoint = {
  key: string;
  label: string;
  value: number;
};

function formatCompactVND(value: number) {
  if (value >= 1_000_000_000) {
    return `${new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 1,
    }).format(value / 1_000_000_000)} tỷ`;
  }
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 0,
    }).format(value / 1_000_000)} tr`;
  }
  return value > 0 ? formatVND(value) : "0";
}

export default function MonthlyRevenueChart({
  data,
}: {
  data: MonthlyRevenuePoint[];
}) {
  const max = Math.max(1, ...data.map((point) => point.value));
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, []);

  return (
    <section className="tf-panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div>
          <h2 className="font-semibold">Doanh thu theo tháng</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Ghi nhận vào tháng dự án chuyển sang On Process.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-400">12 tháng gần nhất</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-zinc-900">
            {formatVND(total)}
          </p>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="overflow-x-auto overscroll-x-contain px-5 pb-5 pt-6"
        aria-label="Biểu đồ doanh thu 12 tháng gần nhất"
      >
        <div className="min-w-[640px] sm:min-w-[720px]">
          <div className="grid h-44 grid-cols-12 items-end gap-3 border-b border-zinc-200 sm:h-52">
            {data.map((point) => {
              const height = point.value > 0 ? Math.max(4, (point.value / max) * 100) : 0;
              return (
                <div
                  key={point.key}
                  className="flex h-full min-w-0 flex-col justify-end"
                  title={`${point.label}: ${formatVND(point.value)}`}
                >
                  <span className="mb-2 truncate text-center text-[10px] font-medium tabular-nums text-zinc-500">
                    {formatCompactVND(point.value)}
                  </span>
                  <div className="flex h-[136px] items-end sm:h-[168px]">
                    <div
                      className="w-full rounded-t-[4px] bg-blue-600 transition-[height]"
                      style={{ height: `${height}%` }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 grid grid-cols-12 gap-3">
            {data.map((point) => (
              <span
                key={point.key}
                className="truncate text-center text-[11px] text-zinc-500"
              >
                {point.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
