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
  Check,
  CheckCircle2,
  Clock,
  ListPlus,
  MessageSquare,
  Paperclip,
  Plus,
} from "lucide-react";
import { moveTask } from "@/app/actions/tasks";
import { STATUSES, PRIORITIES, type MemberDTO, type TaskDTO } from "@/lib/types";
import { formatHour, hasTime, isOverdue } from "@/lib/dates";
import Avatar from "@/components/Avatar";
import NewTaskInline from "@/components/NewTaskInline";
import TaskWorkspaceModal from "@/components/TaskWorkspaceModal";
import { useProjectBoard } from "@/components/ProjectBoardContext";

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
  const board = useProjectBoard();
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
  const [localSignal, setLocalSignal] = useState<{ column: string; count: number }>({
    column: "TODO",
    count: 0,
  });
  const boardScrollerRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();

  const activeSignal = board?.newTaskSignal ?? localSignal;

  function triggerColumnTask(colKey: string) {
    if (board) {
      board.triggerNewTask(colKey);
    } else {
      setLocalSignal((prev) => ({ column: colKey, count: prev.count + 1 }));
    }
    selectColumn(colKey);
  }

  const searchQuery = board?.searchQuery ?? "";
  const priorityFilter = board?.priorityFilter ?? null;
  const assigneeFilter = board?.assigneeFilter ?? null;

  // Filter tasks based on search and filters
  const filteredTasks = tasks.filter((t) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchDesc = t.description?.toLowerCase().includes(q);
      if (!matchTitle && !matchDesc) return false;
    }
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (assigneeFilter && t.assigneeId !== assigneeFilter) return false;
    return true;
  });

  const columns = STATUSES.map((s) => ({
    ...s,
    tasks: filteredTasks
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
    const columnEls = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-board-column]")
    );
    const target = scroller.scrollLeft + 16;
    const closest = columnEls.reduce<HTMLElement | null>((current, column) => {
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
    <div className="flex min-h-0 flex-1 flex-col bg-[#f8f9fa]">
      {/* Mobile Column Navigation Tabs */}
      <nav
        className="tf-scroll-tabs mx-4 mt-3 flex rounded-[8px] bg-zinc-200/70 p-1 md:hidden"
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
              className={`inline-flex min-h-9 items-center gap-2 rounded-[7px] px-3 text-xs font-semibold transition-colors ${
                selected
                  ? "bg-white text-zinc-950 shadow-xs"
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

      {/* Empty State */}
      {tasks.length === 0 && (
        <div className="mx-4 mt-4 flex flex-col gap-3 rounded-[12px] border border-blue-100 bg-blue-50/60 px-4 py-3 sm:mx-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-white text-blue-600 shadow-xs ring-1 ring-blue-100">
              <ListPlus size={16} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-zinc-800">
                Dự án chưa có công việc
              </p>
              <p className="text-xs text-zinc-500">
                Hãy bắt đầu tạo task đầu tiên để giao việc cho các thành viên.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => triggerColumnTask("TODO")}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#a3e635] px-3 text-xs font-semibold text-zinc-950 shadow-xs hover:bg-[#8fd822]"
          >
            <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
            Tạo task đầu tiên
          </button>
        </div>
      )}

      {/* Kanban Board Container */}
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
                className="flex min-h-[520px] w-[calc(100vw-48px)] max-w-[360px] shrink-0 snap-start flex-col overflow-hidden rounded-[14px] border border-zinc-200/70 bg-[#f4f5f7] md:h-full md:min-h-0 md:w-auto md:max-w-none"
              >
                {/* Column Header */}
                <div className="flex items-center justify-between border-b border-zinc-200/60 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${COLUMN_ACCENT[col.key]}`}
                      aria-hidden="true"
                    />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-700">
                      {col.label}
                    </h2>
                    <span className="text-xs font-medium text-zinc-400">
                      {col.tasks.length}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => triggerColumnTask(col.key)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-200/80 hover:text-zinc-800"
                    title={`Thêm task vào ${col.label}`}
                    aria-label={`Thêm task vào ${col.label}`}
                  >
                    <Plus size={15} strokeWidth={2} />
                  </button>
                </div>

                {/* Droppable Task List */}
                <Droppable droppableId={col.key}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`min-h-[80px] flex-1 space-y-2.5 overflow-y-auto p-3 transition-colors ${
                        snapshot.isDraggingOver ? "bg-brand-50/50" : ""
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
                                className={`group relative cursor-pointer space-y-2.5 rounded-[12px] border border-zinc-200/80 bg-white p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition-all hover:border-zinc-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-400/30 ${
                                  snapshot.isDragging
                                    ? "rotate-1 border-brand-400 shadow-xl"
                                    : ""
                                }`}
                              >
                                {/* Top Tag / Badge Row */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {task.status === "DONE" ? (
                                    <span className="inline-flex items-center gap-1 rounded-[6px] border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                      <Check size={11} strokeWidth={2.5} />
                                      Xong
                                    </span>
                                  ) : (
                                    priority && (
                                      <span
                                        className={`inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[11px] font-medium ${
                                          task.priority === "HIGH"
                                            ? "border-rose-100 bg-rose-50 text-rose-700"
                                            : task.priority === "LOW"
                                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                                            : "border-amber-100 bg-amber-50 text-amber-700"
                                        }`}
                                      >
                                        {task.priority === "HIGH"
                                          ? "Ưu tiên cao"
                                          : priority.label}
                                      </span>
                                    )
                                  )}
                                  {task.result && task.status !== "DONE" && (
                                    <span className="inline-flex items-center gap-1 rounded-[6px] border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                      Có kết quả
                                    </span>
                                  )}
                                </div>

                                {/* Task Title */}
                                <div>
                                  <p
                                    className={`min-w-0 text-sm font-semibold leading-snug ${
                                      task.status === "DONE"
                                        ? "text-zinc-600"
                                        : "text-zinc-900"
                                    }`}
                                  >
                                    {task.title}
                                  </p>

                                  {/* Task Description Excerpt */}
                                  {task.description && (
                                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                                      {task.description}
                                    </p>
                                  )}
                                </div>

                                {/* Bottom Metadata Row */}
                                <div className="flex items-center justify-between pt-1">
                                  <div className="flex flex-wrap items-center gap-2.5">
                                    {due && (
                                      <span
                                        className={`inline-flex items-center gap-1 text-[11px] ${
                                          due.overdue && task.status !== "DONE"
                                            ? "font-semibold text-rose-600"
                                            : "text-zinc-500"
                                        }`}
                                      >
                                        {due.overdue && task.status !== "DONE" ? (
                                          <Clock
                                            size={12}
                                            strokeWidth={2}
                                            aria-hidden="true"
                                          />
                                        ) : (
                                          <CalendarDays
                                            size={12}
                                            strokeWidth={1.8}
                                            aria-hidden="true"
                                          />
                                        )}
                                        {due.overdue && task.status !== "DONE"
                                          ? `Hạn chót: ${due.text}`
                                          : due.text}
                                      </span>
                                    )}

                                    {task.files.length > 0 && (
                                      <span
                                        className="inline-flex items-center gap-1 text-[11px] text-zinc-400"
                                        title={`${task.files.length} tệp đính kèm`}
                                      >
                                        <Paperclip
                                          size={12}
                                          strokeWidth={1.8}
                                          aria-hidden="true"
                                        />
                                        {task.files.length} file
                                      </span>
                                    )}

                                    {task.comments.length > 0 && (
                                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                                        <MessageSquare
                                          size={12}
                                          strokeWidth={1.8}
                                          aria-hidden="true"
                                        />
                                        {task.comments.length}
                                      </span>
                                    )}

                                    {task.result && (
                                      <span
                                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"
                                        title="Đã có kết quả công việc"
                                      >
                                        <CheckCircle2
                                          size={12}
                                          strokeWidth={1.8}
                                          aria-hidden="true"
                                        />
                                      </span>
                                    )}
                                  </div>

                                  {assignee && (
                                    <Avatar
                                      id={assignee.userId}
                                      name={assignee.user.name}
                                      avatarUrl={assignee.user.avatarUrl}
                                      className="ml-auto h-6 w-6 text-[10px] ring-2 ring-white shadow-xs"
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

                {/* Column Footer: Inline Task Creator */}
                <div className="shrink-0 border-t border-zinc-200/60 p-2.5">
                  <NewTaskInline
                    key={`${col.key}-${activeSignal.column === col.key ? activeSignal.count : 0}`}
                    projectId={projectId}
                    status={col.key}
                    members={members}
                    defaultOpen={Boolean(
                      activeSignal.column === col.key && activeSignal.count > 0
                    )}
                  />
                </div>
              </div>
            ))}
          </div>
        </DragDropContext>
      </div>

      {openTask && (
        <TaskWorkspaceModal
          task={openTask}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  );
}
