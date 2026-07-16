import type { Perf } from "@/lib/performance";

const RESULT_SEGMENTS = [
  { key: "onTime", label: "Đúng hạn", bar: "bg-brand-400", dot: "bg-brand-400" },
  { key: "late", label: "Trễ hạn", bar: "bg-amber-400", dot: "bg-amber-400" },
] as const;

const OPEN_SEGMENTS = [
  { key: "overdueOpen", label: "Quá hạn", bar: "bg-red-500", dot: "bg-red-500" },
  { key: "inProgress", label: "Đang làm", bar: "bg-blue-500", dot: "bg-blue-500" },
  { key: "todo", label: "Cần làm", bar: "bg-orange-500", dot: "bg-orange-500" },
] as const;

type Segment = (typeof RESULT_SEGMENTS)[number] | (typeof OPEN_SEGMENTS)[number];

function SegmentBar({
  perf,
  segments,
  total,
}: {
  perf: Perf;
  segments: readonly Segment[];
  total: number;
}) {
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100">
      {segments.map((segment) => {
        const value = perf[segment.key];
        if (value === 0) return null;
        return (
          <div
            key={segment.key}
            className={segment.bar}
            style={{ width: `${(value / total) * 100}%` }}
            title={`${segment.label}: ${value}`}
          />
        );
      })}
    </div>
  );
}

function Legend({ perf, segments }: { perf: Perf; segments: readonly Segment[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
      {segments.map((segment) => (
        <span key={segment.key} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${segment.dot}`} aria-hidden="true" />
          {segment.label}: <strong className="text-zinc-700">{perf[segment.key]}</strong>
        </span>
      ))}
    </div>
  );
}

export default function PerformanceBar({
  perf,
  periodLabel,
}: {
  perf: Perf;
  periodLabel?: string;
}) {
  if (perf.total === 0) {
    return (
      <p className="text-sm text-zinc-400">
        Chưa có task nào để đánh giá{periodLabel ? ` trong ${periodLabel.toLowerCase()}` : ""}.
      </p>
    );
  }

  const rate = perf.done > 0 ? Math.round((perf.onTime / perf.done) * 100) : null;
  const openTotal = perf.overdueOpen + perf.inProgress + perf.todo;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-zinc-600">Kết quả trong kỳ</p>
          <p className="text-xs font-medium tabular-nums text-zinc-500">
            {rate !== null
              ? `${rate}% đúng hạn · ${perf.onTime}/${perf.done} task`
              : "Chưa có task hoàn thành"}
          </p>
        </div>
        {perf.done > 0 && (
          <SegmentBar perf={perf} segments={RESULT_SEGMENTS} total={perf.done} />
        )}
        <Legend perf={perf} segments={RESULT_SEGMENTS} />
      </div>

      <div className="space-y-2 border-t border-zinc-200 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-zinc-600">Việc đang mở hiện tại</p>
          <p className="text-xs tabular-nums text-zinc-400">
            {openTotal} task
          </p>
        </div>
        {openTotal > 0 && (
          <SegmentBar perf={perf} segments={OPEN_SEGMENTS} total={openTotal} />
        )}
        <Legend perf={perf} segments={OPEN_SEGMENTS} />
      </div>
    </div>
  );
}
