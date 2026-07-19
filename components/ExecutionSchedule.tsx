import Link from "next/link";
import { CalendarRange, ChevronDown } from "lucide-react";
import { daysUntil, formatExecutionRange } from "@/lib/dates";
import { projectStatusInfo, projectTypeInfo } from "@/lib/types";

export type ScheduleRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  executionStartAt: Date;
  executionEndAt: Date | null;
};

type Classified = ScheduleRow & {
  startDays: number;
  endDays: number;
};

function classify(rows: ScheduleRow[]) {
  const all: Classified[] = rows.map((row) => ({
    ...row,
    startDays: daysUntil(row.executionStartAt),
    endDays: daysUntil(row.executionEndAt ?? row.executionStartAt),
  }));
  return {
    ongoing: all
      .filter((r) => r.startDays <= 0 && r.endDays >= 0)
      .sort((a, b) => a.endDays - b.endDays),
    upcoming: all
      .filter((r) => r.startDays > 0)
      .sort((a, b) => a.startDays - b.startDays),
    past: all
      .filter((r) => r.endDays < 0)
      .sort((a, b) => b.endDays - a.endDays),
  };
}

function countdown(row: Classified): { text: string; className: string } {
  if (row.startDays <= 0 && row.endDays >= 0) {
    return {
      text:
        row.endDays === 0
          ? "Đang diễn ra · kết thúc hôm nay"
          : `Đang diễn ra · còn ${row.endDays} ngày`,
      className: "bg-emerald-100 text-emerald-700",
    };
  }
  if (row.startDays > 0) {
    const text = row.startDays === 1 ? "Ngày mai" : `Còn ${row.startDays} ngày`;
    return row.startDays <= 7
      ? { text, className: "bg-amber-100 text-amber-700" }
      : { text, className: "bg-zinc-100 text-zinc-600" };
  }
  return {
    text: `Xong ${-row.endDays} ngày trước`,
    className: "bg-zinc-100 text-zinc-500",
  };
}

function Row({ row }: { row: Classified }) {
  const typeInfo = projectTypeInfo(row.type);
  const statusInfo = projectStatusInfo(row.status);
  const chip = countdown(row);
  return (
    <Link
      href={`/projects/${row.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 transition-colors hover:bg-zinc-50 sm:flex-nowrap"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: typeInfo.color }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {row.name}
      </span>
      <span className={`tf-badge shrink-0 ${typeInfo.className}`}>
        {typeInfo.label}
      </span>
      <span className={`tf-badge hidden shrink-0 sm:inline-flex ${statusInfo.className}`}>
        {statusInfo.label}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-zinc-500">
        {formatExecutionRange(row.executionStartAt, row.executionEndAt)}
      </span>
      <span
        className={`tf-badge shrink-0 whitespace-nowrap ${chip.className}`}
      >
        {chip.text}
      </span>
    </Link>
  );
}

/** Lịch thực hiện các dự án đã đặt ngày chạy: đang diễn ra, sắp tới, đã qua */
export default function ExecutionSchedule({ rows }: { rows: ScheduleRow[] }) {
  const { ongoing, upcoming, past } = classify(rows);
  const recentPast = past.filter((r) => r.endDays >= -30);

  return (
    <section className="tf-panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3">
        <CalendarRange size={17} className="text-zinc-500" aria-hidden="true" />
        <h2 className="font-semibold">Lịch thực hiện</h2>
        <span className="text-xs text-zinc-400">
          {ongoing.length + upcoming.length} đang chạy / sắp tới
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-400">
          Chưa có dự án nào đặt ngày thực hiện. Mở dự án → nút Sửa để thêm.
        </p>
      ) : (
        <>
          {ongoing.length > 0 && (
            <div>
              <p className="border-b border-zinc-100 bg-emerald-50/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                Đang diễn ra
              </p>
              <div className="divide-y divide-zinc-50">
                {ongoing.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </div>
            </div>
          )}

          {upcoming.length > 0 && (
            <div>
              <p className="border-b border-t border-zinc-100 bg-zinc-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Sắp tới
              </p>
              <div className="divide-y divide-zinc-50">
                {upcoming.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </div>
            </div>
          )}

          {ongoing.length === 0 && upcoming.length === 0 && (
            <p className="px-5 py-4 text-sm text-zinc-400">
              Không có dự án nào đang chạy hoặc sắp tới.
            </p>
          )}

          {recentPast.length > 0 && (
            <details className="group/schedule-past border-t border-zinc-100">
              <summary className="flex cursor-pointer list-none items-center gap-2 bg-zinc-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 transition-colors hover:bg-zinc-100/70 [&::-webkit-details-marker]:hidden">
                Đã diễn ra (30 ngày gần đây)
                <span className="font-normal">{recentPast.length}</span>
                <ChevronDown
                  size={14}
                  className="ml-auto transition-transform group-open/schedule-past:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="divide-y divide-zinc-50">
                {recentPast.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
