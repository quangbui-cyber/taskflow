import type { RevenueRow } from "@/components/RevenueBreakdown";

const WON_COLOR = "#2563eb";
const LOST_COLOR = "#ef4444";

export default function RevenueWinRate({ rows }: { rows: RevenueRow[] }) {
  const ranked = [...rows].sort((a, b) => {
    const aClosed = a.wonCount + a.lostCount;
    const bClosed = b.wonCount + b.lostCount;
    const aRate = aClosed > 0 ? a.wonCount / aClosed : -1;
    const bRate = bClosed > 0 ? b.wonCount / bClosed : -1;
    return bRate - aRate || bClosed - aClosed;
  });

  return (
    <section className="tf-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3">
        <div>
          <h2 className="font-semibold">Tỷ lệ thắng theo Account</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Done được tính là thắng; Fail và Cancel được tính là thua.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: WON_COLOR }}
              aria-hidden="true"
            />
            Thắng
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: LOST_COLOR }}
              aria-hidden="true"
            />
            Thua
          </span>
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-400">Chưa có dữ liệu.</p>
      ) : (
        <ul className="space-y-5 p-5">
          {ranked.map((row) => {
            const closed = row.wonCount + row.lostCount;
            const winRate = closed > 0 ? Math.round((row.wonCount / closed) * 100) : null;
            const lossRate = winRate === null ? 0 : 100 - winRate;

            return (
              <li key={row.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-zinc-900">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-950">
                    {winRate === null ? "Chưa có kết quả" : `${winRate}%`}
                  </span>
                </div>
                <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-zinc-100">
                  {winRate !== null && row.wonCount > 0 && (
                    <div
                      style={{ width: `${winRate}%`, backgroundColor: WON_COLOR }}
                      title={`${row.wonCount} dự án thắng`}
                    />
                  )}
                  {winRate !== null && row.lostCount > 0 && (
                    <div
                      style={{ width: `${lossRate}%`, backgroundColor: LOST_COLOR }}
                      title={`${row.lostCount} dự án thua`}
                    />
                  )}
                </div>
                <p className="mt-1.5 text-xs text-zinc-400">
                  {closed > 0
                    ? `${row.wonCount} thắng · ${row.lostCount} thua · ${closed} dự án đã có kết quả`
                    : `${row.count} dự án chưa có kết quả cuối`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
