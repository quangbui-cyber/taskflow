"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import { updateProjectStatus } from "@/app/actions/projects";
import { PROJECT_STATUSES, projectStatusInfo } from "@/lib/types";
import { useInteraction } from "@/components/InteractionProvider";

const STATUS_DOT_CLASSES: Record<string, string> = {
  BIDDING: "bg-amber-500",
  ON_PROCESS: "bg-blue-500",
  PENDING: "bg-violet-500",
  DONE: "bg-emerald-500",
  CANCEL: "bg-zinc-500",
  FAIL: "bg-red-500",
};

export default function ProjectStatusSelect({
  projectId,
  status,
  canEdit,
}: {
  projectId: string;
  status: string;
  canEdit: boolean;
}) {
  const { notify } = useInteraction();
  const [selectedStatus, setSelectedStatus] = useState(status);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const info = projectStatusInfo(selectedStatus);

  useEffect(() => {
    function closeDropdown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeDropdown, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeDropdown, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function changeStatus(nextStatus: string) {
    if (nextStatus === selectedStatus) {
      setOpen(false);
      return;
    }

    const previousStatus = selectedStatus;
    setSelectedStatus(nextStatus);
    setOpen(false);
    setError("");
    startTransition(async () => {
      const result = await updateProjectStatus(projectId, nextStatus);
      if (result.error) {
        setSelectedStatus(previousStatus);
        setError(result.error);
        notify({ message: result.error, tone: "error" });
      } else {
        notify({
          message: `Đã chuyển dự án sang ${projectStatusInfo(nextStatus).label}.`,
          tone: "success",
        });
      }
    });
  }

  if (!canEdit) {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200/80 bg-zinc-50 px-2.5 text-xs font-medium text-zinc-700">
        <span
          className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[selectedStatus] ?? "bg-zinc-400"}`}
        />
        {info.label}
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={pending}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200/90 bg-zinc-50/90 px-2.5 text-xs font-medium text-zinc-700 shadow-xs transition-colors hover:border-zinc-300 hover:bg-zinc-100 focus:outline-none focus:ring-1 focus:ring-brand-400 disabled:cursor-wait disabled:opacity-60"
        aria-label="Trạng thái dự án"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[selectedStatus] ?? "bg-zinc-400"}`}
        />
        <span>{info.label}</span>
        <ChevronDown
          size={12}
          className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Chọn trạng thái dự án"
          className="tf-popover-enter absolute left-0 top-8 z-50 w-44 overflow-hidden rounded-[8px] border border-zinc-200 bg-white p-1.5 shadow-xl sm:left-auto sm:right-0"
        >
          {PROJECT_STATUSES.map((projectStatus) => {
            const selected = projectStatus.key === selectedStatus;
            return (
              <button
                key={projectStatus.key}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => changeStatus(projectStatus.key)}
                className={`flex w-full items-center justify-between gap-3 rounded-[6px] px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-50 ${selected ? "bg-zinc-50 font-semibold" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[projectStatus.key] ?? "bg-zinc-400"}`}
                  />
                  <span>{projectStatus.label}</span>
                </span>
                {selected && (
                  <Check size={13} className="text-zinc-500" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="absolute -bottom-5 right-0 whitespace-nowrap text-xs text-red-600">{error}</p>}
    </div>
  );
}
