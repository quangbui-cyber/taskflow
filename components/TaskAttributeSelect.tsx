"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type AttributeOption = {
  key: string;
  label: string;
};

export default function TaskAttributeSelect({
  label,
  value,
  onChange,
  options,
  dotClasses,
  name,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly AttributeOption[];
  dotClasses: Record<string, string>;
  name?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const menuId = useId();
  const selected = useMemo(
    () => options.find((option) => option.key === value) ?? options[0],
    [options, value]
  );

  useEffect(() => {
    if (!open) return;

    function placeMenu() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportGap = 12;
      const gap = 6;
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - viewportGap * 2);
      const estimatedHeight = Math.min(options.length * 44 + 12, 240);
      const openAbove = window.innerHeight - rect.bottom < estimatedHeight + gap && rect.top > estimatedHeight;
      setPosition({
        top: openAbove ? rect.top - estimatedHeight - gap : rect.bottom + gap,
        left: Math.min(Math.max(viewportGap, rect.left), window.innerWidth - width - viewportGap),
        width,
      });
    }

    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => buttonRef.current?.focus());
    }

    placeMenu();
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open, options.length]);

  function choose(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  return (
    <div ref={rootRef} className={className}>
      {name && <input type="hidden" name={name} value={value} />}
      <span id={labelId} className="text-xs font-medium text-zinc-500">{label}</span>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`tf-field mt-1 flex w-full items-center justify-between gap-3 !py-1.5 text-left transition-[border-color,box-shadow,background-color] ${
          open ? "!border-brand-500 !shadow-[0_0_0_3px_rgb(168_212_49_/_0.18)]" : "hover:bg-zinc-50/60"
        }`}
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <span className="inline-flex min-w-0 items-center gap-2.5">
          <span className={`size-2.5 shrink-0 rounded-full ring-4 ring-zinc-100 ${dotClasses[selected?.key] ?? "bg-zinc-400"}`} aria-hidden="true" />
          <span className="truncate text-sm font-medium text-zinc-800">{selected?.label}</span>
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-zinc-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && position && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-labelledby={labelId}
          data-floating-layer
          data-open="true"
          className="tf-popover-enter fixed z-[100] overflow-hidden rounded-[9px] border border-zinc-200 bg-white p-1.5 shadow-xl shadow-zinc-900/10"
          style={position}
        >
          {options.map((option) => {
            const isSelected = option.key === value;
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => choose(option.key)}
                className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-[7px] px-3 text-left transition-colors focus:outline-none ${
                  isSelected
                    ? "bg-brand-50 text-zinc-950"
                    : "text-zinc-700 hover:bg-zinc-50 focus:bg-zinc-50"
                }`}
              >
                <span className="inline-flex min-w-0 items-center gap-2.5">
                  <span className={`size-2.5 shrink-0 rounded-full ${dotClasses[option.key] ?? "bg-zinc-400"}`} aria-hidden="true" />
                  <span className={`truncate text-sm ${isSelected ? "font-semibold" : "font-medium"}`}>{option.label}</span>
                </span>
                {isSelected && <Check size={15} className="shrink-0 text-brand-800" aria-hidden="true" />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
