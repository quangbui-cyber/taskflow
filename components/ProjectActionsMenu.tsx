"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { deleteProject } from "@/app/actions/projects";
import { useInteraction } from "@/components/InteractionProvider";

export default function ProjectActionsMenu({
  projectId,
}: {
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const { notify } = useInteraction();
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
        className="tf-icon-button !h-9 !min-h-9 !w-9"
        aria-label="Thao tác khác với dự án"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Thao tác khác"
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="tf-popover-enter absolute right-0 top-11 z-50 w-48 rounded-[8px] border border-zinc-200 bg-white p-1.5 shadow-xl"
        >
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
                void deleteProject(projectId).then(result => {
                  if (result?.error) notify({ message: result.error, tone: "error" });
                }).catch(() => notify({ message: "Không thể xoá dự án. Hãy thử lại.", tone: "error" }));
              }
            }}
            className="flex min-h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 size={15} aria-hidden="true" />
            Xóa dự án
          </button>
        </div>
      )}
    </div>
  );
}
