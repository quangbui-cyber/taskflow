import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import { STATUSES } from "@/lib/types";
import { formatDue, isOverdue } from "@/lib/dates";

const STATUS_BADGE: Record<string, string> = {
  TODO: "bg-zinc-100 text-zinc-600",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  DONE: "bg-emerald-50 text-emerald-700",
};

export type TaskListItemData = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  project: { id: string; name: string; color: string };
  personLabel?: string;
};

export default function TaskListItem({ task }: { task: TaskListItemData }) {
  const statusLabel =
    STATUSES.find((status) => status.key === task.status)?.label ?? task.status;
  const overdue =
    task.dueDate && task.status !== "DONE" && isOverdue(task.dueDate);

  return (
    <Link
      href={`/projects/${task.project.id}`}
      className="group grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-200 px-1 py-3 transition-colors last:border-b-0 hover:bg-zinc-50/80 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:px-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: overdue ? "#ef4444" : task.project.color }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-800 group-hover:text-blue-700">
            {task.title}
          </p>
          <p className="mt-1 truncate text-xs text-zinc-400">
            {task.project.name}
            {task.personLabel ? ` · ${task.personLabel}` : ""}
          </p>
        </div>
      </div>

      <div className="hidden items-center gap-2 sm:flex">
        {task.dueDate && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs ${
              overdue ? "font-medium text-red-600" : "text-zinc-500"
            }`}
          >
            <CalendarDays size={15} strokeWidth={1.8} aria-hidden="true" />
            {formatDue(task.dueDate)}
          </span>
        )}
        <span className={`tf-badge ${STATUS_BADGE[task.status] ?? STATUS_BADGE.TODO}`}>
          {statusLabel}
        </span>
      </div>

      <ChevronRight
        size={17}
        strokeWidth={1.8}
        className="text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-500"
        aria-hidden="true"
      />
    </Link>
  );
}
