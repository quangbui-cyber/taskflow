import { formatVND } from "@/lib/types";
import { progressPercent, sumMonths, targetToDate } from "@/lib/kpi";

const KPI_BLUE = "#2563eb";

export function formatCompactVND(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 2,
    }).format(value / 1_000_000_000)} tỷ`;
  }
  if (abs >= 1_000_000) {
    return `${new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 1,
    }).format(value / 1_000_000)} triệu`;
  }
  return formatVND(value);
}

/** Thanh tiến độ % hoàn thành; vượt 100% vẫn hiện đầy thanh, đổi sang màu xanh lá. */
export function KpiProgressBar({
  actual,
  target,
}: {
  actual: number;
  target: number;
}) {
  const percent = progressPercent(actual, target);
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100"
        role="img"
        aria-label={
          percent === null ? "Chưa có chỉ tiêu" : `Đạt ${percent}% chỉ tiêu`
        }
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, percent ?? 0)}%`,
            backgroundColor:
              percent !== null && percent >= 100 ? "#10b981" : KPI_BLUE,
          }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-700">
        {percent === null ? "—" : `${percent}%`}
      </span>
    </div>
  );
}

/** Bốn chỉ số tổng quan của một đối tượng (công ty, team hoặc Account) trong năm. */
export function KpiSummary({
  yearTarget,
  monthlyTarget,
  actual,
  year,
}: {
  yearTarget: number;
  monthlyTarget: number[];
  actual: number[];
  year: number;
}) {
  const earned = sumMonths(actual);
  const percent = progressPercent(earned, yearTarget);
  const expected = targetToDate(monthlyTarget, year);
  const paceGap = earned - expected;

  return (
    <div className="tf-metric-strip">
      <section className="tf-metric-item">
        <p className="text-xs font-medium text-zinc-500">KPI năm {year}</p>
        <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
          {yearTarget > 0 ? formatCompactVND(yearTarget) : "—"}
        </p>
        <p className="mt-1 text-xs text-zinc-400">Doanh số ghi nhận</p>
      </section>
      <section className="tf-metric-item">
        <p className="text-xs font-medium text-zinc-500">Đã đạt</p>
        <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
          {formatCompactVND(earned)}
        </p>
        <p className="mt-1 text-xs text-zinc-400">On Process + Done</p>
      </section>
      <section className="tf-metric-item">
        <p className="text-xs font-medium text-zinc-500">Hoàn thành</p>
        <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
          {percent === null ? "—" : `${percent}%`}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {yearTarget > earned
            ? `Còn ${formatCompactVND(yearTarget - earned)}`
            : yearTarget > 0
              ? "Đã đạt KPI năm"
              : "Chưa có chỉ tiêu"}
        </p>
      </section>
      <section className="tf-metric-item">
        <p className="text-xs font-medium text-zinc-500">Tiến độ đến tháng này</p>
        <p
          className={`mt-2 text-xl font-semibold tabular-nums ${
            expected <= 0
              ? "text-zinc-950"
              : paceGap >= 0
                ? "text-emerald-600"
                : "text-red-600"
          }`}
        >
          {expected <= 0
            ? "—"
            : `${paceGap >= 0 ? "+" : "−"}${formatCompactVND(Math.abs(paceGap))}`}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {expected <= 0
            ? "Chưa có chỉ tiêu luỹ kế"
            : `So với chỉ tiêu luỹ kế ${formatCompactVND(expected)}`}
        </p>
      </section>
    </div>
  );
}

/** Cột đôi theo tháng: chỉ tiêu (xám) cạnh doanh số ghi nhận (xanh). */
export function KpiMonthlyChart({
  target,
  actual,
}: {
  target: number[];
  actual: number[];
}) {
  const max = Math.max(1, ...target, ...actual);

  return (
    <div>
      <div className="mb-4 flex items-center gap-4 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-zinc-300" />
          Chỉ tiêu
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ backgroundColor: KPI_BLUE }}
          />
          Thực tế
        </span>
      </div>
      <div className="overflow-x-auto">
        <ol className="grid min-w-[560px] grid-cols-12 gap-2">
          {target.map((planned, index) => {
            const earned = actual[index] ?? 0;
            return (
              <li
                key={index}
                className="flex flex-col items-center"
                title={`Tháng ${index + 1}: chỉ tiêu ${formatVND(planned)} · thực tế ${formatVND(earned)}`}
              >
                <div className="flex h-36 w-full items-end justify-center gap-1">
                  <div
                    className="w-1/3 max-w-4 rounded-t-[3px] bg-zinc-300"
                    style={{ height: `${(planned / max) * 100}%` }}
                  />
                  <div
                    className="w-1/3 max-w-4 rounded-t-[3px]"
                    style={{
                      height: `${(earned / max) * 100}%`,
                      backgroundColor: KPI_BLUE,
                    }}
                  />
                </div>
                <span className="mt-2 text-[11px] font-medium text-zinc-500">
                  T{index + 1}
                </span>
                <span className="text-[10px] tabular-nums text-zinc-400">
                  {progressPercent(earned, planned) === null
                    ? "—"
                    : `${progressPercent(earned, planned)}%`}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
