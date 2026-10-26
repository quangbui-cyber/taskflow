"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import {
  CalendarDays,
  CircleCheckBig,
  ListPlus,
  GripVertical,
  MessageSquare,
  Paperclip,
} from "lucide-react";
import { moveTask } from "@/app/actions/tasks";
import { STATUSES, PRIORITIES, type MemberDTO, type TaskDTO } from "@/lib/types";
import { formatHour, hasTime, isOverdue } from "@/lib/dates";
import Avatar from "@/components/Avatar";
import NewTaskInline from "@/components/NewTaskInline";
import TaskModal from "@/components/TaskModal";

const COLUMN_ACCENT: Record<string, string> = {
  TODO: "bg-orange-500",
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
  initialTaskId,
}: {
  projectId: string;
  tasks: TaskDTO[];
  members: MemberDTO[];
  currentUserId: string;
  initialTaskId?: string | null;
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
  const [openTaskId, setOpenTaskId] = useState<string | null>(
    initialTaskId && serverTasks.some((task) => task.id === initialTaskId)
      ? initialTaskId
      : null
  );
  const [visibleColumn, setVisibleColumn] = useState<string>(STATUSES[0].key);
  const [todoComposerSignal, setTodoComposerSignal] = useState(0);
  const boardScrollerRef = useRef<HTMLDivElement>(null);
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

  function selectColumn(status: string) {
    const scroller = boardScrollerRef.current;
    const column = scroller?.querySelector<HTMLElement>(
      `[data-board-column="${status}"]`
    );
    if (scroller && column) {
      scroller.scrollTo({
        left: Math.max(0, column.offsetLeft - 16),
        behavior: "smooth",
      });
    }
    setVisibleColumn(status);
  }

  function syncVisibleColumn() {
    const scroller = boardScrollerRef.current;
    if (!scroller) return;
    const columns = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-board-column]")
    );
    const target = scroller.scrollLeft + 16;
    const closest = columns.reduce<HTMLElement | null>((current, column) => {
      if (!current) return column;
      return Math.abs(column.offsetLeft - target) <
        Math.abs(current.offsetLeft - target)
        ? column
        : current;
    }, null);
    const status = closest?.dataset.boardColumn;
    if (status && status !== visibleColumn) setVisibleColumn(status);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f8fa]">
      <nav
        className="tf-scroll-tabs mx-4 mt-4 flex rounded-[8px] bg-zinc-200/70 p-1 md:hidden"
        aria-label="Chọn cột công việc"
      >
        {STATUSES.map((status) => {
          const selected = visibleColumn === status.key;
          return (
            <button
              key={status.key}
              type="button"
              aria-pressed={selected}
              onClick={() => selectColumn(status.key)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-[7px] px-3 text-sm font-medium transition-colors ${
                selected
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-500"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${COLUMN_ACCENT[status.key]}`}
                aria-hidden="true"
              />
              {status.label}
            </button>
          );
        })}
      </nav>

      {tasks.length === 0 && (
        <div className="mx-4 mt-4 flex flex-col gap-3 rounded-[8px] border border-blue-100 bg-blue-50/70 px-4 py-3 sm:mx-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-white text-blue-600 shadow-sm ring-1 ring-blue-100">
              <ListPlus size={17} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-zinc-800">
                Dự án chưa có công việc
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              selectColumn("TODO");
              setTodoComposerSignal((value) => value + 1);
            }}
            className="tf-button-secondary shrink-0 !min-h-9 !px-3 !py-1.5 text-xs"
          >
            <ListPlus size={15} aria-hidden="true" />
            Tạo task đầu tiên
          </button>
        </div>
      )}

      <div
        ref={boardScrollerRef}
        onScroll={syncVisibleColumn}
        className="flex-1 snap-x snap-mandatory scroll-px-4 overflow-x-auto overflow-y-hidden p-4 sm:p-6 md:snap-none"
      >
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex h-full gap-3 md:grid md:min-w-[760px] md:grid-cols-3 md:gap-4">
          {columns.map((col) => (
            <div
              key={col.key}
              data-board-column={col.key}
              className="flex min-h-[520px] w-[calc(100vw-48px)] max-w-[360px] shrink-0 snap-start flex-col overflow-hidden rounded-[8px] border border-zinc-200 bg-[#f1f3f5] md:h-full md:min-h-0 md:w-auto md:max-w-none"
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
                                {task.files.length > 0 && (
                                  <span
                                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400"
                                    title={`${task.files.length} tệp đính kèm`}
                                  >
                                    <Paperclip size={13} strokeWidth={1.8} aria-hidden="true" />
                                    {task.files.length}
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
                                  <Avatar
                                    id={assignee.userId}
                                    name={assignee.user.name}
                                    avatarUrl={assignee.user.avatarUrl}
                                    className="ml-auto h-7 w-7 text-[11px]"
                                  />
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

              <div className="shrink-0 border-t border-zinc-200 p-3">
                <NewTaskInline
                  key={`${col.key}-${col.key === "TODO" ? todoComposerSignal : 0}`}
                  projectId={projectId}
                  status={col.key}
                  members={members}
                  defaultOpen={
                    col.key === "TODO" && todoComposerSignal > 0
                  }
                />
              </div>
            </div>
          ))}
          </div>
        </DragDropContext>
      </div>

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
