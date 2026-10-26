"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { groupProjectsForPicker, type PickerGroup, type PickerProject } from "@/lib/projectPickerGroups";

const STATUS_DOT_CLASSES: Record<string, string> = {
  BIDDING: "bg-amber-500",
  ON_PROCESS: "bg-blue-500",
  PENDING: "bg-violet-500",
  DONE: "bg-emerald-500",
  CANCEL: "bg-zinc-500",
  FAIL: "bg-red-500",
};

export default function GroupedProjectPicker({
  projects,
  value,
  onChange,
  disabled,
  labelId,
}: {
  projects: PickerProject[];
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
  labelId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { primary, others, otherCount } = useMemo(() => groupProjectsForPicker(projects), [projects]);
  const selected = projects.find((project) => project.id === value);
  const selectedIsOther = Boolean(selected && others.some((group) => group.status === selected.status));

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggle() {
    // Đang chọn một dự án thuộc nhóm thu gọn thì mở sẵn nhóm đó để thấy dấu tick.
    if (!open && selectedIsOther) setShowOthers(true);
    setOpen((current) => !current);
  }

  function choose(projectId: string) {
    onChange(projectId);
    setOpen(false);
  }

  function renderGroup(group: PickerGroup) {
    return (
      <div key={group.status} role="group" aria-label={group.label} className="py-1">
        <p className="flex items-center gap-2 px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT_CLASSES[group.status] ?? "bg-zinc-400"}`} aria-hidden="true" />
          {group.label}
          <span className="font-normal normal-case text-zinc-400">{group.projects.length}</span>
        </p>
        {group.projects.map((project) => {
          const isSelected = project.id === value;
          return (
            <button
              key={project.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => choose(project.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-[6px] px-2.5 py-2 text-left text-sm text-zinc-800 transition-colors hover:bg-zinc-50 ${isSelected ? "bg-zinc-50 font-medium" : ""}`}
            >
              <span className="min-w-0 truncate">{project.name}</span>
              {isSelected && <Check size={15} className="shrink-0 text-zinc-500" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || projects.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId}
        className="tf-field flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`flex min-w-0 items-center gap-2 ${selected ? "text-zinc-800" : "text-zinc-500"}`}>
          {selected && (
            <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASSES[selected.status] ?? "bg-zinc-400"}`} aria-hidden="true" />
          )}
          <span className="truncate">{selected?.name ?? "Chọn dự án"}</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          className="tf-popover-enter absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-[8px] border border-zinc-200 bg-white p-1.5 shadow-xl"
        >
          {primary.map(renderGroup)}
          {primary.length === 0 && (
            <p className="px-2.5 py-2 text-sm text-zinc-500">Không có dự án đang Bidding hoặc On Process.</p>
          )}

          {otherCount > 0 && (
            <div className="mt-1 border-t border-zinc-100 pt-1">
              <button
                type="button"
                onClick={() => setShowOthers((current) => !current)}
                aria-expanded={showOthers}
                className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                <ChevronRight size={15} className={`shrink-0 text-zinc-400 transition-transform ${showOthers ? "rotate-90" : ""}`} aria-hidden="true" />
                Dự án khác
                <span className="text-zinc-400">({otherCount})</span>
              </button>
              {showOthers && others.map(renderGroup)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
