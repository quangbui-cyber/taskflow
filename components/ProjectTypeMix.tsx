import { formatVND } from "@/lib/types";

export type TypeSlice = {
  key: string;
  label: string;
  color: string;
  value: number; // doanh số ghi nhận (On Process + Done)
  count: number; // tổng số dự án thuộc loại hình
};

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

/** Donut cơ cấu doanh số ghi nhận theo loại hình dự án */
export default function ProjectTypeMix({ slices }: { slices: TypeSlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const active = slices.filter((slice) => slice.value > 0);

  // Khe trắng mảnh giữa các múi để mắt tách được từng loại hình,
  // kể cả khi hai màu cạnh nhau khó phân biệt.
  const GAP = active.length > 1 ? 0.7 : 0;
  const stops: string[] = [];
  let cursor = 0;
  for (const slice of active) {
    const share = total > 0 ? (slice.value / total) * 100 : 0;
    const start = cursor;
    const end = cursor + share;
    stops.push(`${slice.color} ${start}% ${Math.max(start, end - GAP)}%`);
    if (GAP > 0) stops.push(`#ffffff ${Math.max(start, end - GAP)}% ${end}%`);
    cursor = end;
  }
  const chartBackground =
    stops.length > 0 ? `conic-gradient(${stops.join(", ")})` : "#f4f4f5";

  return (
    <section className="tf-panel p-5">
      <div>
        <h2 className="font-semibold">Cơ cấu loại hình</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Tỷ trọng doanh số ghi nhận (On Process + Done) theo loại hình dự án.
        </p>
      </div>

      <div className="mt-6 grid items-center gap-8 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[200px]">
          <div
            className="relative aspect-square rounded-full"
            style={{ background: chartBackground }}
            role="img"
            aria-label={`Tổng doanh số ghi nhận ${formatVND(total)}`}
          >
            <div className="absolute inset-[24%] flex flex-col items-center justify-center rounded-full bg-white text-center shadow-[0_0_0_1px_rgba(228,228,231,0.7)]">
              <span className="text-[10px] font-medium uppercase text-zinc-400">
                Ghi nhận
              </span>
              <strong
                className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-950"
                title={formatVND(total)}
              >
                {formatCompactVND(total)}
              </strong>
            </div>
          </div>
        </div>

        <ul>
          {slices.map((slice) => {
            const percent =
              total > 0 ? Math.round((slice.value / total) * 100) : 0;
            return (
              <li
                key={slice.key}
                className="flex items-center gap-3 border-b border-zinc-100 py-2.5 last:border-b-0"
                title={`${slice.label}: ${formatVND(slice.value)} · ${slice.count} dự án`}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: slice.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium uppercase text-zinc-500">
                  {slice.label}
                </span>
                <span className="shrink-0 text-xs text-zinc-400">
                  {slice.count} dự án
                </span>
                <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-950">
                  {formatCompactVND(slice.value)}
                </span>
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-zinc-400">
                  {percent}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
