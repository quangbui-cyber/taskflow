"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Menu } from "lucide-react";

export default function MobileSidebarMenu({
  children,
}: {
  children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!detailsRef.current?.contains(event.target as Node)) {
        detailsRef.current?.removeAttribute("open");
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        detailsRef.current?.removeAttribute("open");
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <details ref={detailsRef} className="group relative">
      <summary
        role="button"
        className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-[7px] border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
        aria-label="Mở điều hướng"
      >
        <Menu size={20} aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}
