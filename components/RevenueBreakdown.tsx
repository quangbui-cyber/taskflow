import { formatVND } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

const REVENUE_BLUE = "#2563eb";
const REVENUE_BLUE_DARK = "#1d4ed8";

export type RevenueRow = {
  name: string;
  earned: number;
  bidding: number;
  count: number;
  wonCount: number;
  lostCount: number;
};

/** Bar chart ngang: thanh xanh = doanh thu thực, thanh vàng mảnh = đang bidding */
export default function RevenueBreakdown({
  title,
  rows,
  icon: Icon,
}: {
  title: string;
  rows: RevenueRow[];
  icon?: LucideIcon;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.earned, r.bidding)));

  return (
    <section className="tf-panel overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          {Icon && <Icon size={17} className="text-zinc-500" aria-hidden="true" />}
          {title}
        </h2>
        <span className="text-[11px] text-zinc-400">
          <span
            className="mr-1 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: REVENUE_BLUE }}
          />
          <span style={{ color: REVENUE_BLUE_DARK }}>Doanh thu</span>
          <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />
          Bidding
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-400">Chưa có dữ liệu.</p>
      ) : (
        <ul className="space-y-4 p-5">
          {rows.map((r) => {
            const closedCount = r.wonCount + r.lostCount;
            const winRate =
              closedCount > 0 ? Math.round((r.wonCount / closedCount) * 100) : null;

            return (
            <li key={r.name}>
              <div className="mb-2 flex items-baseline gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">
                  {r.name}
                  <span className="ml-1.5 text-xs font-normal text-zinc-400">
                    {r.count} dự án
                  </span>
                  {winRate !== null && (
                    <span className="ml-1.5 text-xs font-normal text-zinc-400">
                      · {winRate}% thành công
                    </span>
                  )}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3">
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(r.earned / max) * 100}%`,
                      backgroundColor: r.earned > 0 ? REVENUE_BLUE : undefined,
                    }}
                  />
                </div>
                <span className="text-right text-[13px] font-medium tabular-nums text-zinc-900">
                  {formatVND(r.earned)}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3">
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{ width: `${(r.bidding / max) * 100}%` }}
                  />
                </div>
                <span className="text-right text-[13px] font-medium tabular-nums text-zinc-900">
                  {formatVND(r.bidding)}
                </span>
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
