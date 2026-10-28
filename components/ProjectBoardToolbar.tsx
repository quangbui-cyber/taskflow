"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Kanban,
  List,
  ListFilter,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useProjectBoard } from "@/components/ProjectBoardContext";
import { PRIORITIES, type MemberDTO } from "@/lib/types";

export default function ProjectBoardToolbar({
  members = [],
}: {
  members?: MemberDTO[];
}) {
  const board = useProjectBoard();
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      if (!filterRef.current?.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setFilterOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  if (!board) return null;

  const {
    searchQuery,
    setSearchQuery,
    priorityFilter,
    setPriorityFilter,
    assigneeFilter,
    setAssigneeFilter,
    triggerNewTask,
    viewMode,
    setViewMode,
  } = board;

  const hasActiveFilter = Boolean(priorityFilter || assigneeFilter);

  return (
    <div className="flex items-center gap-2">
      {/* Quick search input */}
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
          aria-hidden="true"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Tìm task nhanh..."
          className="h-8 w-40 rounded-[8px] border border-zinc-200 bg-zinc-50/70 pl-8 pr-7 text-xs text-zinc-800 placeholder:text-zinc-400 transition-colors focus:border-brand-400 focus:bg-white focus:outline-none sm:w-52"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            aria-label="Xoá tìm kiếm"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Filter Popover */}
      <div ref={filterRef} className="relative">
        <button
          type="button"
          onClick={() => setFilterOpen((v) => !v)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-xs font-medium transition-colors ${
            hasActiveFilter
              ? "border-brand-300 bg-brand-50 text-brand-900"
              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
          }`}
          aria-expanded={filterOpen}
          aria-label="Lọc công việc"
        >
          <ListFilter size={13} strokeWidth={2} aria-hidden="true" />
          <span>Lọc</span>
          {hasActiveFilter && (
            <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
          )}
        </button>

        {filterOpen && (
          <div className="tf-popover-enter absolute right-0 top-9.5 z-40 w-56 rounded-[10px] border border-zinc-200 bg-white p-3 shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
              <span className="text-xs font-semibold text-zinc-800">Bộ lọc</span>
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setPriorityFilter(null);
                    setAssigneeFilter(null);
                  }}
                  className="text-[11px] text-brand-700 hover:underline"
                >
                  Xoá lọc
                </button>
              )}
            </div>

            {/* Filter by Priority */}
            <div className="mt-2.5">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                Độ ưu tiên
              </span>
              <div className="mt-1 space-y-0.5">
                {PRIORITIES.map((p) => {
                  const selected = priorityFilter === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() =>
                        setPriorityFilter(selected ? null : p.key)
                      }
                      className={`flex w-full items-center justify-between rounded-[6px] px-2 py-1 text-xs transition-colors ${
                        selected
                          ? "bg-brand-50 font-semibold text-brand-900"
                          : "text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      <span>{p.label}</span>
                      {selected && <Check size={12} className="text-brand-600" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Filter by Assignee */}
            {members.length > 0 && (
              <div className="mt-3 border-t border-zinc-100 pt-2">
                <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                  Người thực hiện
                </span>
                <div className="mt-1 max-h-36 space-y-0.5 overflow-y-auto">
                  {members.map((m) => {
                    const selected = assigneeFilter === m.userId;
                    return (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() =>
                          setAssigneeFilter(selected ? null : m.userId)
                        }
                        className={`flex w-full items-center justify-between rounded-[6px] px-2 py-1 text-xs transition-colors ${
                          selected
                            ? "bg-brand-50 font-semibold text-brand-900"
                            : "text-zinc-600 hover:bg-zinc-50"
                        }`}
                      >
                        <span className="truncate">{m.user.name}</span>
                        {selected && (
                          <Check size={12} className="text-brand-600" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* View Switcher: Kanban / List / Calendar */}
      <div className="hidden items-center rounded-[8px] border border-zinc-200 bg-white p-0.5 sm:flex">
        <button
          type="button"
          onClick={() => setViewMode("kanban")}
          className={`rounded-[6px] p-1.5 transition-colors ${
            viewMode === "kanban"
              ? "bg-zinc-100 text-zinc-900"
              : "text-zinc-400 hover:text-zinc-700"
          }`}
          title="Xem dạng Kanban"
          aria-label="Xem dạng Kanban"
        >
          <Kanban size={13} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setViewMode("list")}
          className={`rounded-[6px] p-1.5 transition-colors ${
            viewMode === "list"
              ? "bg-zinc-100 text-zinc-900"
              : "text-zinc-400 hover:text-zinc-700"
          }`}
          title="Xem dạng danh sách"
          aria-label="Xem dạng danh sách"
        >
          <List size={13} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setViewMode("calendar")}
          className={`rounded-[6px] p-1.5 transition-colors ${
            viewMode === "calendar"
              ? "bg-zinc-100 text-zinc-900"
              : "text-zinc-400 hover:text-zinc-700"
          }`}
          title="Xem dạng lịch"
          aria-label="Xem dạng lịch"
        >
          <CalendarDays size={13} strokeWidth={2} />
        </button>
      </div>

      {/* + Tạo task button */}
      <button
        type="button"
        onClick={() => triggerNewTask("TODO")}
        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#a3e635] px-3 text-xs font-semibold text-zinc-950 shadow-xs transition hover:bg-[#8fd822]"
      >
        <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
        <span>Tạo task</span>
      </button>
    </div>
  );
}
