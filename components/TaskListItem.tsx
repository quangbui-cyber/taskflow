import Link from "next/link";
import { ArrowRight, CalendarDays, Building2, Target } from "lucide-react";
import { taskStatusLabel, isClosedTaskStatus } from "@/lib/types";
import type { TaskOwnerDisplay } from "@/lib/taskQueries";
import { ownerHref } from "@/lib/workOwner";
import { formatDue, isOverdue } from "@/lib/dates";

const STATUS_BADGE: Record<string, string> = {
  TODO: "bg-orange-50 text-orange-700",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  DONE: "bg-emerald-50 text-emerald-700",
};

export type TaskListItemData = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  owner: TaskOwnerDisplay;
  personLabel?: string;
};

export default function TaskListItem({ task }: { task: TaskListItemData }) {
  const statusLabel = taskStatusLabel(task.status);
  const overdue =
    task.dueDate && !isClosedTaskStatus(task.status) && isOverdue(task.dueDate);

  return (
    <Link
      href={ownerHref(task.owner, task.id)}
      aria-label={`Xem công việc ${task.title} · ${task.owner.name}`}
      title="Mở chi tiết công việc"
      className="group grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-200 px-1 py-3 transition-colors last:border-b-0 hover:bg-zinc-50/80 focus-visible:rounded-[7px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/40 sm:px-3 xl:grid-cols-[minmax(0,1fr)_auto_auto]"
    >
      <div className="flex min-w-0 items-center gap-3">
        {task.owner.kind === "CLIENT" ? <Building2 size={14} className="shrink-0 text-zinc-500" aria-hidden="true" /> : task.owner.kind === "OPPORTUNITY" ? <Target size={14} className="shrink-0 text-zinc-500" aria-hidden="true" /> : <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{
            backgroundColor: overdue
              ? "#ef4444"
              : task.owner.color ?? "#71717a",
          }}
          aria-hidden="true"
        />}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-800 group-hover:text-brand-700">
            {task.title}
          </p>
          <p className="mt-1 truncate text-xs text-zinc-400">
            {task.owner.kind === "OPPORTUNITY" ? "Cơ hội · " : ""}{task.owner.name}
            {task.personLabel ? ` · ${task.personLabel}` : ""}
          </p>
          <div className="mt-1.5 flex min-w-0 items-center gap-2 xl:hidden">
            {task.dueDate && (
              <span
                className={`inline-flex min-w-0 items-center gap-1 text-[11px] ${
                  overdue ? "font-normal text-red-600" : "text-zinc-500"
                }`}
              >
                <CalendarDays size={13} strokeWidth={1.8} aria-hidden="true" />
                <span className="truncate">{formatDue(task.dueDate)}</span>
              </span>
            )}
            <span
              className={`tf-badge shrink-0 !px-1.5 !py-0.5 !text-[10px] ${
                STATUS_BADGE[task.status] ?? STATUS_BADGE.TODO
              }`}
            >
              {statusLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="hidden items-center gap-2 xl:flex">
        {task.dueDate && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs ${
              overdue ? "font-normal text-red-600" : "text-zinc-500"
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

      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-normal text-zinc-400 transition-colors group-hover:text-brand-700">
        <span className="hidden whitespace-nowrap sm:inline">Xem công việc</span>
        <ArrowRight
          size={16}
          strokeWidth={1.8}
          className="transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}
