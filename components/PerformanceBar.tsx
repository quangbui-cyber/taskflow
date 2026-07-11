import type { Perf } from "@/lib/performance";

const SEGMENTS = [
  { key: "onTime", label: "Đúng hạn", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  { key: "late", label: "Trễ hạn", bar: "bg-amber-400", dot: "bg-amber-400" },
  { key: "overdueOpen", label: "Quá hạn chưa xong", bar: "bg-red-500", dot: "bg-red-500" },
  { key: "open", label: "Đang mở", bar: "bg-zinc-300", dot: "bg-zinc-300" },
] as const;

export default function PerformanceBar({ perf }: { perf: Perf }) {
  if (perf.total === 0) {
    return <p className="text-sm text-zinc-400">Chưa có task nào để đánh giá.</p>;
  }

  const rate = Math.round((perf.onTime / perf.total) * 100);

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-100">
        {SEGMENTS.map((s) => {
          const value = perf[s.key];
          if (value === 0) return null;
          return (
            <div
              key={s.key}
              className={s.bar}
              style={{ width: `${(value / perf.total) * 100}%` }}
              title={`${s.label}: ${value}`}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-4 flex-wrap text-xs text-zinc-500">
        {SEGMENTS.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${s.dot}`} />
            {s.label}: <strong className="text-zinc-700">{perf[s.key]}</strong>
          </span>
        ))}
        <span className="ml-auto font-medium text-zinc-600">
          {rate}% đúng hạn · {perf.done}/{perf.total} hoàn thành
        </span>
      </div>
    </div>
  );
}
