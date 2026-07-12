"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import {
  CalendarDays,
  CircleCheckBig,
  GripVertical,
  MessageSquare,
} from "lucide-react";
import { moveTask } from "@/app/actions/tasks";
import { STATUSES, PRIORITIES, type MemberDTO, type TaskDTO } from "@/lib/types";
import { avatarClass } from "@/lib/avatar";
import { formatHour, hasTime, isOverdue } from "@/lib/dates";
import NewTaskInline from "@/components/NewTaskInline";
import TaskModal from "@/components/TaskModal";

const COLUMN_ACCENT: Record<string, string> = {
  TODO: "bg-zinc-400",
  IN_PROGRESS: "bg-blue-500",
  DONE: "bg-emerald-500",
};

function formatDue(dueDate: string) {
  const d = new Date(dueDate);
  const dateStr = d.toLocaleDateString("vi-VN", {
    day: "numeric",
    month: "numeric",
  });
  const timeStr = hasTime(d) ? " " + formatHour(d) : "";
  return { text: dateStr + timeStr, overdue: isOverdue(d) };
}

export default function Board({
  projectId,
  tasks: serverTasks,
  members,
  currentUserId,
}: {
  projectId: string;
  tasks: TaskDTO[];
  members: MemberDTO[];
  currentUserId: string;
}) {
  const [tasks, moveTaskOptimistically] = useOptimistic(
    serverTasks,
    (
      currentTasks,
      movedTask: { id: string; status: string; order: number }
    ) =>
      currentTasks.map((t) =>
        t.id === movedTask.id
          ? { ...t, status: movedTask.status, order: movedTask.order }
          : t
      )
  );
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const columns = STATUSES.map((s) => ({
    ...s,
    tasks: tasks
      .filter((t) => t.status === s.key)
      .sort((a, b) => a.order - b.order),
  }));

  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    )
      return;

    const destTasks = tasks
      .filter(
        (t) => t.status === destination.droppableId && t.id !== draggableId
      )
      .sort((a, b) => a.order - b.order);

    const before = destTasks[destination.index - 1]?.order;
    const after = destTasks[destination.index]?.order;
    const newOrder =
      before !== undefined && after !== undefined
        ? (before + after) / 2
        : before !== undefined
          ? before + 1
          : after !== undefined
            ? after - 1
            : 1;

    startTransition(() => {
      moveTaskOptimistically({
        id: draggableId,
        status: destination.droppableId,
        order: newOrder,
      });
      moveTask(draggableId, destination.droppableId, newOrder);
    });
  }

  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden bg-[#f7f8fa] p-4 sm:p-6">
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid h-full min-w-[760px] grid-cols-3 gap-4">
          {columns.map((col) => (
            <div
              key={col.key}
              className="flex min-h-[calc(100vh-172px)] flex-col overflow-hidden rounded-[8px] border border-zinc-200 bg-[#f1f3f5]"
            >
              <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className={`h-2 w-2 rounded-full ${COLUMN_ACCENT[col.key]}`} aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-zinc-800">{col.label}</h2>
                </div>
                <span className="tf-badge border border-zinc-200 bg-white text-zinc-500">
                  {col.tasks.length}
                </span>
              </div>

              <Droppable droppableId={col.key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`min-h-[80px] flex-1 space-y-2 overflow-y-auto p-3 transition-colors ${
                      snapshot.isDraggingOver ? "bg-brand-50/70" : ""
                    }`}
                  >
                    {col.tasks.map((task, index) => {
                      const assignee = members.find(
                        (m) => m.userId === task.assigneeId
                      );
                      const priority = PRIORITIES.find(
                        (p) => p.key === task.priority
                      );
                      const due = task.dueDate ? formatDue(task.dueDate) : null;
                      return (
                        <Draggable
                          key={task.id}
                          draggableId={task.id}
                          index={index}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              onClick={() => setOpenTaskId(task.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setOpenTaskId(task.id);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              className={`group relative cursor-pointer rounded-[8px] border border-zinc-200 bg-white p-3.5 shadow-sm transition-all hover:border-brand-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-400/30 ${
                                snapshot.isDragging
                                  ? "rotate-1 border-brand-400 shadow-lg"
                                  : ""
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <GripVertical
                                  size={15}
                                  className="mt-0.5 shrink-0 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100"
                                  aria-hidden="true"
                                />
                                <p
                                  className={`min-w-0 flex-1 text-sm font-semibold leading-snug ${
                                  task.status === "DONE"
                                    ? "line-through text-zinc-400"
                                    : "text-zinc-800"
                                  }`}
                                >
                                  {task.title}
                                </p>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {priority && (
                                  <span className={`tf-badge ${priority.className}`}>
                                    {priority.label}
                                  </span>
                                )}
                                {due && (
                                  <span
                                    className={`inline-flex items-center gap-1 text-[11px] ${
                                      due.overdue && task.status !== "DONE"
                                        ? "font-semibold text-red-600"
                                        : "text-zinc-500"
                                    }`}
                                  >
                                    <CalendarDays size={13} strokeWidth={1.8} aria-hidden="true" />
                                    {due.text}
                                  </span>
                                )}
                                {task.comments.length > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                                    <MessageSquare size={13} strokeWidth={1.8} aria-hidden="true" />
                                    {task.comments.length}
                                  </span>
                                )}
                                {task.result && (
                                  <span
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"
                                    title="Đã có kết quả công việc"
                                  >
                                    <CircleCheckBig
                                      size={13}
                                      strokeWidth={1.8}
                                      aria-hidden="true"
                                    />
                                    Kết quả
                                  </span>
                                )}
                                {assignee && (
                                  <span
                                    className={`ml-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ${avatarClass(assignee.userId)}`}
                                    title={assignee.user.name}
                                  >
                                    {assignee.user.name.charAt(0).toUpperCase()}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>

              <div className="border-t border-zinc-200 p-3">
                <NewTaskInline
                  projectId={projectId}
                  status={col.key}
                  members={members}
                />
              </div>
            </div>
          ))}
        </div>
      </DragDropContext>

      {openTask && (
        <TaskModal
          task={openTask}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  );
}
