"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { deleteProject } from "@/app/actions/projects";

export default function ProjectActionsMenu({
  projectId,
  isOwner = true,
  children,
}: {
  projectId: string;
  isOwner?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-zinc-200 bg-white text-zinc-500 shadow-xs transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800 focus:outline-none"
        aria-label="Thao tác khác với dự án"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Thao tác khác"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="tf-popover-enter absolute right-0 top-9.5 z-50 w-52 rounded-[10px] border border-zinc-200 bg-white p-1.5 shadow-xl"
        >
          {children && (
            <div onClick={() => setOpen(false)} className="space-y-0.5 border-b border-zinc-100 pb-1 mb-1">
              {children}
            </div>
          )}

          {isOwner && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (
                  window.confirm(
                    "Xóa dự án này? Tất cả task, bình luận và tài liệu sẽ mất vĩnh viễn."
                  )
                ) {
                  void deleteProject(projectId);
                }
              }}
              className="flex min-h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 size={14} aria-hidden="true" />
              Xóa dự án
            </button>
          )}
        </div>
      )}
    </div>
  );
}
