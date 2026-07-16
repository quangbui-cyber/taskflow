"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export default function ProjectDescriptionDisclosure({
  description,
}: {
  description: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-zinc-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-[7px] py-1 text-left text-sm transition-colors hover:text-zinc-950"
        aria-expanded={open}
      >
        <span className="font-medium text-zinc-700">Mô tả dự án</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-500">
          {open ? "Thu gọn" : "Xem thêm"}
          <ChevronDown
            size={14}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>
      {open && (
        <p className="mt-2 whitespace-pre-line rounded-[8px] bg-zinc-50 px-3 py-2.5 text-sm leading-6 text-zinc-600">
          {description}
        </p>
      )}
    </div>
  );
}
