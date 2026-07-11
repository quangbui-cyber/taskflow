import { deadline, isOverdue } from "@/lib/dates";

export type Perf = {
  onTime: number; // hoàn thành đúng hạn (hoặc không có hạn)
  late: number; // hoàn thành nhưng trễ hạn
  overdueOpen: number; // quá hạn mà chưa hoàn thành
  open: number; // đang mở, chưa tới hạn
  done: number;
  total: number;
};

export function computePerf(
  tasks: { status: string; dueDate: Date | null; completedAt: Date | null }[]
): Perf {
  let onTime = 0;
  let late = 0;
  let overdueOpen = 0;
  let open = 0;

  for (const t of tasks) {
    if (t.status === "DONE") {
      if (t.dueDate && t.completedAt && t.completedAt > deadline(t.dueDate)) {
        late++;
      } else {
        onTime++;
      }
    } else if (t.dueDate && isOverdue(t.dueDate)) {
      overdueOpen++;
    } else {
      open++;
    }
  }

  return {
    onTime,
    late,
    overdueOpen,
    open,
    done: onTime + late,
    total: tasks.length,
  };
}
