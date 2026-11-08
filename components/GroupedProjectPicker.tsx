"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronDown, ChevronRight, Target } from "lucide-react";
import { groupProjectsForPicker, type PickerCrmTargets, type PickerOwnerGroup, type PickerOwnerItem, type PickerProject } from "@/lib/projectPickerGroups";
import type { WorkOwner } from "@/lib/workOwner";

const STATUS_DOT_CLASSES: Record<string, string> = {
  BIDDING: "bg-amber-500",
  ON_PROCESS: "bg-blue-500",
  PENDING: "bg-violet-500",
  DONE: "bg-emerald-500",
  CANCEL: "bg-zinc-500",
  FAIL: "bg-red-500",
};

type Props = {
  projects: PickerProject[];
  disabled?: boolean;
  labelId?: string;
} & ({ ownerMode: true; value: WorkOwner | null; onChange: (owner: WorkOwner) => void } & PickerCrmTargets | {
  ownerMode?: false;
  value: string;
  onChange: (projectId: string) => void;
  opportunities?: never;
  clients?: never;
});

export default function GroupedProjectPicker(props: Props) {
  const { projects, disabled, labelId } = props;
  const [open, setOpen] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { primary, others, otherCount, crm, groups } = useMemo(() => groupProjectsForPicker(projects, { opportunities: props.opportunities, clients: props.clients }), [projects, props.opportunities, props.clients]);
  const value: WorkOwner | null = props.ownerMode ? props.value : props.value ? { kind: "PROJECT", id: props.value } : null;
  const selected = groups.flatMap((group) => group.items).find((item) => item.id === value?.id && item.kind === value?.kind);
  const selectedIsOther = !!selected && selected.kind === "PROJECT" && others.some((group) => group.status === selected.status);
  const empty = groups.length === 0;

  useEffect(() => {
    if (!open) return;
    const list = rootRef.current?.querySelector('[role="listbox"]');
    (list?.querySelector('[aria-selected="true"]') ?? list?.querySelector('[role="option"]'))?.scrollIntoView({ block: "nearest" });
    function closeOnOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector('button')?.focus();
      }
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

  function choose(owner: WorkOwner) {
    if (props.ownerMode) props.onChange({ kind: owner.kind, id: owner.id });
    else props.onChange(owner.id);
    setOpen(false);
    rootRef.current?.querySelector('button')?.focus();
  }

  const icon = (item: Pick<PickerOwnerItem, "kind" | "status">) => item.kind === "OPPORTUNITY" ? <Target size={14} aria-hidden="true" className="shrink-0 text-zinc-500" /> : item.kind === "CLIENT" ? <Building2 size={14} aria-hidden="true" className="shrink-0 text-zinc-500" /> : <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASSES[item.status ?? ""] ?? "bg-zinc-400"}`} aria-hidden="true" />;
  function renderGroup(group: PickerOwnerGroup) {
    return (
      <div key={group.key} role="group" aria-label={group.label} className="py-1">
        <p className="flex items-center gap-2 px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {icon({ kind: group.key === "opportunities" ? "OPPORTUNITY" : group.key === "clients" ? "CLIENT" : "PROJECT", status: group.key })}
          {group.label}
          <span className="font-normal normal-case text-zinc-400">{group.items.length}</span>
        </p>
        {group.items.map((item) => {
          const isSelected = item.id === value?.id && item.kind === value?.kind;
          return (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => choose(item)}
              className={`flex w-full items-center justify-between gap-3 rounded-[6px] px-2.5 py-2 text-left text-sm text-zinc-800 transition-colors hover:bg-zinc-50 ${isSelected ? "bg-zinc-50 font-semibold" : ""}`}
            >
              <span className="min-w-0 truncate">{item.label}</span>
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
        disabled={disabled || empty}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId}
        aria-label={labelId ? undefined : props.ownerMode ? "Nơi sở hữu công việc" : "Dự án"}
        className="tf-field flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`flex min-w-0 items-center gap-2 ${selected ? "text-zinc-800" : "text-zinc-500"}`}>
          {selected && icon(selected)}
          <span className="truncate">{selected?.label ?? (empty ? props.ownerMode ? "Không có dự án, Cơ hội hoặc khách để chọn." : "Không có dự án để chọn." : props.ownerMode ? "Chọn dự án, Cơ hội hoặc khách" : "Chọn dự án")}</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          aria-label={labelId ? undefined : props.ownerMode ? "Nơi sở hữu công việc" : "Dự án"}
          className="tf-popover-enter absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-[8px] border border-zinc-200 bg-white p-1.5 shadow-xl"
        >
          {primary.map(renderGroup)}

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
          {crm.map(renderGroup)}
        </div>
      )}
    </div>
  );
}
