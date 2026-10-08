"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, X } from "lucide-react";
import { formatVND, projectStatusInfo } from "@/lib/types";

export type ClientRevenueProject = {
  id: string;
  name: string;
  status: string;
  revenue: number;
};

export type ClientRevenueRow = {
  key: string;
  name: string;
  earned: number; // doanh số ghi nhận (On Process + Done)
  bidding: number;
  count: number;
  wonCount: number;
  lostCount: number;
  projects: ClientRevenueProject[];
};

// Màu theo cấp bậc doanh số ghi nhận của client: cùng một tông xanh,
// càng đậm doanh số càng lớn. Thứ tự từ cấp cao xuống thấp.
const REVENUE_TIERS = [
  { min: 5_000_000_000, label: "Từ 5 tỷ", color: "#172554" },
  { min: 2_000_000_000, label: "2 – 5 tỷ", color: "#1e3a8a" },
  { min: 1_000_000_000, label: "1 – 2 tỷ", color: "#1d4ed8" },
  { min: 500_000_000, label: "500 triệu – 1 tỷ", color: "#3b82f6" },
  { min: 0, label: "Dưới 500 triệu", color: "#93c5fd" },
] as const;

function revenueTier(earned: number) {
  return (
    REVENUE_TIERS.find((tier) => earned >= tier.min) ??
    REVENUE_TIERS[REVENUE_TIERS.length - 1]
  );
}

// Bán kính + nửa nét (kể cả khi múi được chọn dày thêm) phải nằm trong viewBox 100.
const RADIUS = 38;
const STROKE = 18;

function formatCompactVND(value: number) {
  if (value >= 1_000_000_000) {
    return `${new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 2,
    }).format(value / 1_000_000_000)} tỷ`;
  }
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 1,
    }).format(value / 1_000_000)} triệu`;
  }
  return formatVND(value);
}

function formatPercent(value: number, total: number) {
  if (total <= 0 || value <= 0) return "0%";
  const percent = (value / total) * 100;
  if (percent < 1) return "<1%";
  return `${new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 1,
  }).format(percent)}%`;
}

/** Donut tỷ trọng doanh số ghi nhận theo Client; nhấp vào client để xem chi tiết */
export default function ClientRevenueDonut({
  rows,
}: {
  rows: ClientRevenueRow[];
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const total = rows.reduce((sum, row) => sum + row.earned, 0);
  const colored = rows.map((row) => ({
    ...row,
    color: revenueTier(row.earned).color,
  }));
  const active = colored.filter((row) => row.earned > 0);
  const selected = colored.find((row) => row.key === selectedKey) ?? null;

  const toggle = (key: string) =>
    setSelectedKey((current) => (current === key ? null : key));

  // Khe hở mảnh giữa các múi để tách được hai màu cạnh nhau.
  const GAP = active.length > 1 ? 0.6 : 0;
  const arcs = active.map((row, index) => {
    const share = (row.earned / total) * 100;
    const offset = active
      .slice(0, index)
      .reduce((sum, prev) => sum + (prev.earned / total) * 100, 0);
    return { row, offset, length: Math.max(0.2, share - GAP) };
  });

  const closedCount = selected ? selected.wonCount + selected.lostCount : 0;
  const winRate =
    selected && closedCount > 0
      ? Math.round((selected.wonCount / closedCount) * 100)
      : null;

  return (
    <section className="tf-panel overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Building2 size={17} className="text-zinc-500" aria-hidden="true" />
          Doanh số theo Client
        </h2>
        <span className="text-[11px] text-zinc-400">
          Nhấp vào client để xem chi tiết
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-400">Chưa có dữ liệu.</p>
      ) : (
        <div className="grid items-start gap-8 p-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[260px]">
            <div className="relative aspect-square">
              <svg
                viewBox="0 0 100 100"
                className="h-full w-full -rotate-90"
                role="img"
                aria-label={`Tỷ trọng doanh số ghi nhận theo Client, tổng ${formatVND(total)}`}
              >
                <circle
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  stroke="#f4f4f5"
                  strokeWidth={STROKE}
                />
                {arcs.map(({ row, offset, length }) => {
                  const isSelected = row.key === selectedKey;
                  return (
                    <circle
                      key={row.key}
                      cx="50"
                      cy="50"
                      r={RADIUS}
                      fill="none"
                      stroke={row.color}
                      strokeWidth={isSelected ? STROKE + 3 : STROKE}
                      pathLength={100}
                      strokeDasharray={`${length} ${100 - length}`}
                      strokeDashoffset={-offset}
                      opacity={selectedKey && !isSelected ? 0.35 : 1}
                      className="cursor-pointer transition-all duration-200"
                      onClick={() => toggle(row.key)}
                    >
                      <title>
                        {`${row.name}: ${formatVND(row.earned)} (${formatPercent(row.earned, total)})`}
                      </title>
                    </circle>
                  );
                })}
              </svg>
              <div className="pointer-events-none absolute inset-[27%] flex flex-col items-center justify-center rounded-full text-center">
                <span className="max-w-full truncate text-[10px] font-medium uppercase text-zinc-400">
                  {selected ? selected.name : "Ghi nhận"}
                </span>
                <strong className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-950">
                  {selected
                    ? formatPercent(selected.earned, total)
                    : formatCompactVND(total)}
                </strong>
                {selected && (
                  <span className="text-[11px] tabular-nums text-zinc-500">
                    {formatCompactVND(selected.earned)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <ul
              className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 px-2 text-[11px] text-zinc-500"
              aria-label="Cấp bậc doanh số"
            >
              {[...REVENUE_TIERS].reverse().map((tier) => (
                <li key={tier.label} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tier.color }}
                    aria-hidden="true"
                  />
                  {tier.label}
                </li>
              ))}
            </ul>
            <ul>
              {colored.map((row) => {
                const isSelected = row.key === selectedKey;
                return (
                  <li
                    key={row.key}
                    className="border-b border-zinc-100 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      aria-pressed={isSelected}
                      className={`flex w-full items-center gap-3 rounded-[6px] px-2 py-2 text-left transition-colors hover:bg-zinc-50 ${
                        isSelected ? "bg-blue-50 hover:bg-blue-50" : ""
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            row.earned > 0 ? row.color : "#e4e4e7",
                        }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
                        {row.name}
                      </span>
                      <span className="hidden shrink-0 text-xs text-zinc-400 sm:inline">
                        {row.count} dự án
                      </span>
                      <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-950">
                        {formatCompactVND(row.earned)}
                      </span>
                      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-500">
                        {formatPercent(row.earned, total)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {selected && (
        <div className="border-t border-zinc-100 bg-zinc-50/60 p-5">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{
                backgroundColor: selected.earned > 0 ? selected.color : "#e4e4e7",
              }}
              aria-hidden="true"
            />
            <h3 className="min-w-0 flex-1 truncate font-semibold">
              {selected.name}
            </h3>
            <button
              type="button"
              onClick={() => setSelectedKey(null)}
              className="rounded-[6px] p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="Đóng chi tiết"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-[8px] border border-zinc-100 bg-white px-3 py-2.5">
              <dt className="text-xs text-zinc-500">Doanh số ghi nhận</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-zinc-950">
                {formatVND(selected.earned)}
              </dd>
            </div>
            <div className="rounded-[8px] border border-zinc-100 bg-white px-3 py-2.5">
              <dt className="text-xs text-zinc-500">Tỷ trọng</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-zinc-950">
                {formatPercent(selected.earned, total)}
              </dd>
            </div>
            <div className="rounded-[8px] border border-zinc-100 bg-white px-3 py-2.5">
              <dt className="text-xs text-zinc-500">Đang Bidding</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-zinc-950">
                {formatVND(selected.bidding)}
              </dd>
            </div>
            <div className="rounded-[8px] border border-zinc-100 bg-white px-3 py-2.5">
              <dt className="text-xs text-zinc-500">Tỷ lệ thành công</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-zinc-950">
                {winRate === null ? "—" : `${winRate}%`}
                <span className="ml-1.5 text-xs font-normal text-zinc-400">
                  {selected.count} dự án
                </span>
              </dd>
            </div>
          </dl>

          <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-[8px] border border-zinc-100 bg-white">
            {selected.projects.map((project) => {
              const status = projectStatusInfo(project.status);
              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-zinc-50"
                  >
                    <span className="min-w-0 flex-1 text-sm font-medium sm:truncate">
                      {project.name}
                    </span>
                    <span className={`tf-badge shrink-0 ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-700 sm:w-28">
                      {formatVND(project.revenue)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
