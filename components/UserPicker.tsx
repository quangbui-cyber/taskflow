"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import Avatar from "@/components/Avatar";

export type UserPickerOption = {
  id: string;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
  meta?: string | null;
};

export default function UserPicker({
  options,
  value,
  defaultValue = "",
  onChange,
  name,
  placeholder = "Chọn người dùng",
  emptyLabel,
  disabled = false,
  ariaLabel,
  className = "",
  controlClassName = "",
  menuPlacement = "bottom",
  density = "default",
}: {
  options: UserPickerOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  controlClassName?: string;
  menuPlacement?: "top" | "bottom";
  density?: "default" | "compact" | "quiet";
}) {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
  } | null>(null);
  const selectedValue = controlled ? value : internalValue;
  const selected = useMemo(
    () => options.find((option) => option.id === selectedValue) ?? null,
    [options, selectedValue]
  );

  useEffect(() => {
    function closePicker(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
        setMenuPosition(null);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setMenuPosition(null);
      }
    }
    document.addEventListener("pointerdown", closePicker);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closePicker);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function placeMenu() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const viewportGap = 12;
      const menuGap = 8;
      const width = Math.min(
        Math.max(rect.width, 260),
        window.innerWidth - viewportGap * 2
      );
      const left = Math.min(
        Math.max(viewportGap, rect.left),
        window.innerWidth - width - viewportGap
      );
      const spaceAbove = rect.top - viewportGap;
      const spaceBelow = window.innerHeight - rect.bottom - viewportGap;
      const placeAbove =
        menuPlacement === "top"
          ? spaceAbove >= 120 || spaceAbove >= spaceBelow
          : spaceBelow < 160 && spaceAbove > spaceBelow;

      setMenuPosition(
        placeAbove
          ? {
              left,
              bottom: window.innerHeight - rect.top + menuGap,
              width,
            }
          : { left, top: rect.bottom + menuGap, width }
      );
    }

    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [menuPlacement, open]);

  function selectValue(nextValue: string) {
    if (!controlled) setInternalValue(nextValue);
    onChange?.(nextValue);
    setOpen(false);
    setMenuPosition(null);
  }

  function togglePicker() {
    if (open) {
      setOpen(false);
      setMenuPosition(null);
      return;
    }
    setMenuPosition(null);
    setOpen(true);
  }

  const buttonClassName =
    density === "quiet"
      ? "flex min-h-9 w-full items-center justify-between gap-2 rounded-[7px] border border-transparent bg-zinc-50/70 px-2.5 py-1.5 text-left transition-colors hover:border-zinc-200 hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:opacity-50"
      : density === "compact"
        ? "tf-field flex !min-h-9 w-full items-center justify-between gap-2 !py-1.5 text-left disabled:opacity-50"
        : "tf-field flex w-full items-center justify-between gap-2 !py-1.5 text-left disabled:opacity-50";
  const selectedAvatarClassName =
    density === "default" ? "h-7 w-7 text-xs" : "h-6 w-6 text-[11px]";
  const selectedNameClassName =
    density === "default" ? "text-sm" : "text-xs";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {name && <input type="hidden" name={name} value={selectedValue ?? ""} />}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={togglePicker}
        className={`${buttonClassName} ${controlClassName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? placeholder}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar
              id={selected.id}
              name={selected.name}
              avatarUrl={selected.avatarUrl}
              className={selectedAvatarClassName}
            />
            <span className="min-w-0">
              <span className={`block truncate font-medium text-zinc-800 ${selectedNameClassName}`}>
                {selected.name}
              </span>
              {(selected.email || selected.meta) && (
                <span className="block truncate text-xs text-zinc-400">
                  {[selected.email, selected.meta].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
          </span>
        ) : (
          <span className="truncate text-sm text-zinc-500">{placeholder}</span>
        )}
        <ChevronDown
          size={15}
          className="mr-1 shrink-0 text-zinc-400"
          aria-hidden="true"
        />
      </button>

      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          className="tf-popover-enter fixed z-[100] max-h-72 overflow-y-auto rounded-[8px] border border-zinc-200 bg-white p-1 shadow-xl"
          style={menuPosition}
          role="listbox"
        >
          {emptyLabel && (
            <button
              type="button"
              onClick={() => selectValue("")}
              className={`flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-2 text-left transition-colors hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none ${
                !selectedValue ? "bg-zinc-50" : ""
              }`}
              role="option"
              aria-selected={!selectedValue}
            >
              <span className="text-sm text-zinc-500">{emptyLabel}</span>
              {!selectedValue && <Check size={15} className="text-zinc-500" aria-hidden="true" />}
            </button>
          )}
          {options.map((option) => {
            const isSelected = option.id === selectedValue;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => selectValue(option.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-[6px] px-2 py-2 text-left transition-colors hover:bg-brand-50 focus:bg-brand-50 focus:outline-none ${
                  isSelected ? "bg-brand-50" : ""
                }`}
                role="option"
                aria-selected={isSelected}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar
                    id={option.id}
                    name={option.name}
                    avatarUrl={option.avatarUrl}
                    className="h-8 w-8 text-xs"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-800">
                      {option.name}
                    </span>
                    {(option.email || option.meta) && (
                      <span className="block truncate text-xs text-zinc-400">
                        {[option.email, option.meta].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </span>
                {isSelected && <Check size={15} className="shrink-0 text-zinc-500" aria-hidden="true" />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
