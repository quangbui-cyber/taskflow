import { formatVND } from "@/lib/types";

export type TypeSlice = {
  key: string;
  label: string;
  color: string; // màu nhận diện loại hình (badge); biểu đồ tô theo thứ hạng doanh số
  value: number; // doanh số ghi nhận (On Process + Done)
  bidding: number; // giá trị đang Bidding
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

/** Donut cơ cấu doanh số ghi nhận theo loại hình dự án, kèm giá trị đang Bidding */
// Một tông xanh đậm dần theo doanh số: loại hình lớn nhất đậm nhất.
const RANK_COLORS = [
  "#1e3a8a",
  "#1d4ed8",
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
  "#bfdbfe",
];
const NO_REVENUE_COLOR = "#e4e4e7";

export default function ProjectTypeMix({
  slices: unsortedSlices,
}: {
  slices: TypeSlice[];
}) {
  const slices = [...unsortedSlices]
    .sort((a, b) => b.value - a.value)
    .map((slice, index) => ({
      ...slice,
      color:
        slice.value > 0
          ? RANK_COLORS[Math.min(index, RANK_COLORS.length - 1)]
          : NO_REVENUE_COLOR,
    }));
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
        <h2 className="font-semibold">Doanh số theo loại hình</h2>
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
                <span className="min-w-[6.5rem] flex-1 truncate text-xs font-medium uppercase text-zinc-500">
                  {slice.label}
                </span>
                <span className="hidden shrink-0 text-xs text-zinc-400 sm:inline">
                  {slice.count} dự án
                </span>
                <span
                  className="hidden w-36 shrink-0 text-right text-xs tabular-nums text-amber-600 xl:inline"
                  title={`Đang Bidding: ${formatVND(slice.bidding)}`}
                >
                  {slice.bidding > 0
                    ? `Bidding ${formatCompactVND(slice.bidding)}`
                    : ""}
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
