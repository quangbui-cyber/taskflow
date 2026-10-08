import { formatVND } from "@/lib/types";

export type PipelineStage = {
  key: string;
  label: string;
  value: number;
  count: number;
  color: string;
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

export default function RevenuePipeline({ stages }: { stages: PipelineStage[] }) {
  const total = stages.reduce((sum, stage) => sum + stage.value, 0);
  const activeStages = stages.filter((stage) => stage.value > 0);
  // Khe trắng mảnh giữa các múi: các trạng thái dùng chung tông màu nên cần tách bằng khe.
  const GAP = activeStages.length > 1 ? 0.7 : 0;
  const chartStops = activeStages.flatMap((stage, index) => {
    const startValue = activeStages
      .slice(0, index)
      .reduce((sum, item) => sum + item.value, 0);
    const endValue = startValue + stage.value;
    const start = total > 0 ? (startValue / total) * 100 : 0;
    const end = total > 0 ? (endValue / total) * 100 : 0;
    const fillEnd = Math.max(start, end - GAP);
    return GAP > 0
      ? [`${stage.color} ${start}% ${fillEnd}%`, `#ffffff ${fillEnd}% ${end}%`]
      : [`${stage.color} ${start}% ${end}%`];
  });
  const chartBackground =
    chartStops.length > 0
      ? `conic-gradient(${chartStops.join(", ")})`
      : "#f4f4f5";

  return (
    <section className="tf-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold">Pipeline dự án</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Giá trị hiện tại của dự án theo từng trạng thái.
          </p>
        </div>
      </div>

      <div className="mt-6 grid items-center gap-8 lg:grid-cols-[240px_minmax(0,1fr)] xl:gap-12">
        <div className="mx-auto w-full max-w-[240px]">
          <div
            className="relative aspect-square rounded-full"
            style={{ background: chartBackground }}
            role="img"
            aria-label={`Tổng pipeline ${formatVND(total)}`}
          >
            <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-white text-center shadow-[0_0_0_1px_rgba(228,228,231,0.7)]">
              <span className="text-[11px] font-medium uppercase text-zinc-400">
                Tổng pipeline
              </span>
              <strong
                className="mt-1 text-xl font-semibold tabular-nums text-zinc-950"
                title={formatVND(total)}
              >
                {formatCompactVND(total)}
              </strong>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          {stages.map((stage) => {
            const percent = total > 0 ? Math.round((stage.value / total) * 100) : 0;
            return (
              <div
                key={stage.key}
                className="flex items-center gap-3 border-b border-zinc-100 py-3"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: stage.color }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-medium uppercase text-zinc-500">
                      {stage.label}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                      {percent}%
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-semibold tabular-nums text-zinc-950">
                      {formatVND(stage.value)}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {stage.count} dự án
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
