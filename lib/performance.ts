import { deadline, isOverdue } from "@/lib/dates";

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export const PERFORMANCE_PERIOD_OPTIONS = [
  { key: "month", label: "Tháng này" },
  { key: "previous-month", label: "Tháng trước" },
  { key: "quarter", label: "Quý này" },
] as const;

export type PerformancePeriodKey =
  (typeof PERFORMANCE_PERIOD_OPTIONS)[number]["key"];

function vnMonthBoundary(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1) - VN_OFFSET_MS);
}

export function getPerformancePeriod(
  value: string | undefined,
  now = new Date()
): {
  key: PerformancePeriodKey;
  label: string;
  start: Date;
  end: Date;
} {
  const key = PERFORMANCE_PERIOD_OPTIONS.some((option) => option.key === value)
    ? (value as PerformancePeriodKey)
    : "month";
  const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
  const year = vnNow.getUTCFullYear();
  const month = vnNow.getUTCMonth();

  if (key === "previous-month") {
    const start = vnMonthBoundary(year, month - 1);
    const previousMonth = new Date(Date.UTC(year, month - 1, 1));
    return {
      key,
      label: `Tháng ${previousMonth.getUTCMonth() + 1}/${previousMonth.getUTCFullYear()}`,
      start,
      end: vnMonthBoundary(year, month),
    };
  }

  if (key === "quarter") {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    return {
      key,
      label: `Quý ${Math.floor(month / 3) + 1}/${year}`,
      start: vnMonthBoundary(year, quarterStartMonth),
      end: vnMonthBoundary(year, quarterStartMonth + 3),
    };
  }

  return {
    key,
    label: `Tháng ${month + 1}/${year}`,
    start: vnMonthBoundary(year, month),
    end: vnMonthBoundary(year, month + 1),
  };
}

export type Perf = {
  onTime: number; // hoàn thành đúng hạn (hoặc không có hạn)
  late: number; // hoàn thành nhưng trễ hạn
  overdueOpen: number; // quá hạn mà chưa hoàn thành
  inProgress: number; // đang làm, chưa quá hạn
  todo: number; // cần làm, chưa quá hạn hoặc không có hạn
  done: number;
  total: number;
};

export function combinePeriodResultsWithActiveWork(
  periodResults: Perf,
  activeWork: Perf
): Perf {
  const done = periodResults.onTime + periodResults.late;
  const total =
    done + activeWork.overdueOpen + activeWork.inProgress + activeWork.todo;

  return {
    onTime: periodResults.onTime,
    late: periodResults.late,
    overdueOpen: activeWork.overdueOpen,
    inProgress: activeWork.inProgress,
    todo: activeWork.todo,
    done,
    total,
  };
}

export function computePerf(
  tasks: { status: string; dueDate: Date | null; completedAt: Date | null }[]
): Perf {
  let onTime = 0;
  let late = 0;
  let overdueOpen = 0;
  let inProgress = 0;
  let todo = 0;

  for (const t of tasks) {
    if (t.status === "DONE") {
      // Không có thời điểm hoàn thành thì không thể xếp task vào một kỳ đánh giá.
      if (!t.completedAt) continue;

      // Task hoàn thành không có deadline được xem là hoàn thành đúng hạn.
      if (!t.dueDate || t.completedAt <= deadline(t.dueDate)) {
        onTime++;
      } else {
        late++;
      }
    } else if (t.dueDate && isOverdue(t.dueDate)) {
      overdueOpen++;
    } else if (t.status === "IN_PROGRESS") {
      inProgress++;
    } else {
      todo++;
    }
  }

  return {
    onTime,
    late,
    overdueOpen,
    inProgress,
    todo,
    done: onTime + late,
    total: onTime + late + overdueOpen + inProgress + todo,
  };
}
