"use client";

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
} from "lucide-react";

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const HALF_HOUR_SLOTS = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  return `${hour}:${index % 2 ? "30" : "00"}`;
});

type Position = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  ready: boolean;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : null;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDate(value: string) {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(date)
    : "";
}

function formatMonth(date: Date) {
  const text = new Intl.DateTimeFormat("vi-VN", {
    month: "long",
    year: "numeric",
  }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function startOfGrid(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function inRange(value: string, start: string, end: string) {
  return Boolean(start && end && value > start && value < end);
}

function useFloatingPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
  width: number,
  dependencies: unknown[] = []
) {
  const [position, setPosition] = useState<Position>({
    top: 16,
    left: 16,
    width,
    maxHeight: 0,
    ready: false,
  });

  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const padding = 16;
      const gap = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const actualWidth = Math.min(width, viewportWidth - padding * 2);
      const naturalHeight = popover.scrollHeight;
      const rect = trigger.getBoundingClientRect();

      if (viewportWidth < 640) {
        const maxHeight = viewportHeight - padding * 2;
        setPosition({
          top: viewportHeight - padding - Math.min(naturalHeight, maxHeight),
          left: padding,
          width: actualWidth,
          maxHeight,
          ready: true,
        });
        return;
      }

      const below = viewportHeight - rect.bottom - gap - padding;
      const above = rect.top - gap - padding;
      const openAbove = naturalHeight > below && (naturalHeight <= above || above > below);
      const maxHeight = Math.max(0, openAbove ? above : below);
      const height = Math.min(naturalHeight, maxHeight);
      const left = Math.min(
        viewportWidth - padding - actualWidth,
        Math.max(padding, rect.right - actualWidth)
      );
      setPosition({
        top: openAbove ? Math.max(padding, rect.top - gap - height) : rect.bottom + gap,
        left,
        width: actualWidth,
        maxHeight,
        ready: true,
      });
    }

    update();
    const observer = new ResizeObserver(update);
    if (popoverRef.current) observer.observe(popoverRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
    // dependencies intentionally let callers reposition after content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, width, ...dependencies]);

  return {
    top: position.top,
    left: position.left,
    width: position.width,
    maxHeight: position.maxHeight || undefined,
    visibility: position.ready ? "visible" : "hidden",
  } satisfies CSSProperties;
}

function useDismissPopover(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
  close: (restoreFocus?: boolean) => void
) {
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        close(false);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close(true);
      }
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, triggerRef, popoverRef, close]);
}

function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>, container: HTMLDivElement | null) {
  if (event.key !== "Tab" || !container) return;
  const items = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function CalendarGrid({
  month,
  start,
  end,
  focused,
  min,
  selectingEnd = false,
  maxEndYearOfStart = false,
  onMonthChange,
  onFocusChange,
  onSelect,
}: {
  month: Date;
  start: string;
  end: string;
  focused: string;
  min?: string;
  selectingEnd?: boolean;
  maxEndYearOfStart?: boolean;
  onMonthChange: (month: Date) => void;
  onFocusChange: (value: string) => void;
  onSelect: (value: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => {
    const first = startOfGrid(month);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(first);
      day.setDate(first.getDate() + index);
      return day;
    });
  }, [month]);
  const today = todayKey();

  function moveFocus(current: Date, amount: number) {
    const next = new Date(current);
    next.setDate(current.getDate() + amount);
    const value = dateKey(next);
    onFocusChange(value);
    onMonthChange(new Date(next.getFullYear(), next.getMonth(), 1, 12));
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${value}"]`)?.focus();
    });
  }

  function keydown(event: ReactKeyboardEvent<HTMLButtonElement>, day: Date) {
    const offset = (day.getDay() + 6) % 7;
    const movements: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -offset,
      End: 6 - offset,
    };
    if (event.key in movements) {
      event.preventDefault();
      moveFocus(day, movements[event.key]);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const next = new Date(day);
      next.setMonth(day.getMonth() + (event.key === "PageUp" ? -1 : 1));
      moveFocus(next, 0);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-sm font-semibold text-zinc-800">{formatMonth(month)}</p>
        <div className="flex gap-1">
          {[-1, 1].map((direction) => (
            <button
              key={direction}
              type="button"
              onClick={() =>
                onMonthChange(
                  new Date(month.getFullYear(), month.getMonth() + direction, 1, 12)
                )
              }
              className="inline-flex size-8 items-center justify-center rounded-[7px] text-zinc-600 transition-[background-color,color,transform] duration-150 hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand-500"
              aria-label={direction < 0 ? "Tháng trước" : "Tháng sau"}
            >
              {direction < 0 ? (
                <ChevronLeft size={16} aria-hidden="true" />
              ) : (
                <ChevronRight size={16} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={gridRef}
        className="mt-3 grid grid-cols-7 gap-1 text-center"
        role="grid"
        aria-label={formatMonth(month)}
      >
        {WEEKDAYS.map((weekday) => (
          <span
            key={weekday}
            role="columnheader"
            className="flex h-6 items-center justify-center text-[10px] font-semibold text-zinc-500"
          >
            {weekday}
          </span>
        ))}
        {days.map((day) => {
          const value = dateKey(day);
          const isStart = value === start;
          const isEnd = value === end;
          const selected = isStart || isEnd;
          const between = inRange(value, start, end);
          const outside = day.getMonth() !== month.getMonth();
          const afterStartYear = Boolean(
            selectingEnd &&
              maxEndYearOfStart &&
              start &&
              value > start &&
              value.slice(0, 4) !== start.slice(0, 4)
          );
          const disabled = Boolean((min && value < min) || afterStartYear);
          return (
            <button
              key={value}
              type="button"
              data-date={value}
              role="gridcell"
              tabIndex={value === focused ? 0 : -1}
              disabled={disabled}
              onFocus={() => onFocusChange(value)}
              onKeyDown={(event) => keydown(event, day)}
              onClick={() => onSelect(value)}
              className={`relative mx-auto inline-flex size-8 items-center justify-center rounded-[7px] text-xs font-medium tabular-nums transition-[background-color,color,transform] duration-150 active:scale-[0.98] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:text-zinc-200 ${
                selected
                  ? "bg-brand-500 text-zinc-950"
                  : between
                    ? "bg-brand-50 text-brand-900"
                    : outside
                      ? "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500"
                      : "text-zinc-700 hover:bg-zinc-100"
              }`}
              aria-label={new Intl.DateTimeFormat("vi-VN", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(day)}
              aria-selected={selected || between}
            >
              {day.getDate()}
              {value === today && !selected && (
                <span className="absolute bottom-0.5 size-1 rounded-full bg-brand-600" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

type DateRangeFieldProps = {
  label: string;
  startName?: string;
  endName?: string;
  startValue?: string;
  endValue?: string;
  defaultStartValue?: string;
  defaultEndValue?: string;
  onChange?: (start: string, end: string) => void;
  disabled?: boolean;
  required?: boolean;
  allowOpenEnd?: boolean;
  minDate?: string;
  maxEndYearOfStart?: boolean;
  optionalLabel?: string;
  helperText?: string;
  className?: string;
  singleDateMode?: boolean;
};

export function DateRangeField({
  label,
  startName,
  endName,
  startValue,
  endValue,
  defaultStartValue = "",
  defaultEndValue = "",
  onChange,
  disabled = false,
  required = false,
  allowOpenEnd = true,
  minDate,
  maxEndYearOfStart = false,
  optionalLabel = "Không bắt buộc",
  helperText,
  className = "",
  singleDateMode = false,
}: DateRangeFieldProps) {
  const controlled = startValue !== undefined || endValue !== undefined;
  const [internalStart, setInternalStart] = useState(defaultStartValue);
  const [internalEnd, setInternalEnd] = useState(defaultEndValue);
  const committedStart = controlled ? startValue ?? "" : internalStart;
  const committedEnd = controlled ? endValue ?? "" : internalEnd;
  const [draftStart, setDraftStart] = useState(committedStart);
  const [draftEnd, setDraftEnd] = useState(committedEnd);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [open, setOpen] = useState(false);
  const initial = parseDate(committedStart) ?? new Date();
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1, 12));
  const [focused, setFocused] = useState(committedStart || todayKey());
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const labelId = useId();
  const style = useFloatingPosition(open, triggerRef, popoverRef, 336, [month, selectingEnd]);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => buttonRef.current?.focus());
  }
  useDismissPopover(open, triggerRef, popoverRef, close);

  function show() {
    const active = parseDate(committedStart) ?? new Date();
    setDraftStart(committedStart);
    setDraftEnd(committedEnd);
    setSelectingEnd(false);
    setMonth(new Date(active.getFullYear(), active.getMonth(), 1, 12));
    setFocused(committedStart || todayKey());
    setOpen(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        popoverRef.current
          ?.querySelector<HTMLButtonElement>(`[data-date="${committedStart || todayKey()}"]`)
          ?.focus()
      )
    );
  }

  function choose(value: string) {
    if (singleDateMode) {
      commit(value, value);
      return;
    }
    if (!selectingEnd || !draftStart || draftEnd) {
      setDraftStart(value);
      setDraftEnd("");
      setSelectingEnd(true);
      return;
    }
    if (value < draftStart) {
      setDraftStart(value);
      setDraftEnd("");
      return;
    }
    setDraftEnd(value);
    setSelectingEnd(false);
  }

  function commit(start: string, end: string) {
    const normalizedEnd = start && !end && !allowOpenEnd ? start : end;
    if (!controlled) {
      setInternalStart(start);
      setInternalEnd(normalizedEnd);
    }
    onChange?.(start, normalizedEnd);
    close(true);
  }

  const summary = committedStart
    ? committedEnd && committedEnd !== committedStart
      ? `${formatDate(committedStart)} – ${formatDate(committedEnd)}`
      : formatDate(committedStart)
    : "Chọn ngày";

  return (
    <div className={className}>
      {startName && <input type="hidden" name={startName} value={committedStart} />}
      {endName && <input type="hidden" name={endName} value={committedEnd} />}
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-xs font-medium text-zinc-500">{label}</span>
        {!required && optionalLabel && <span className="text-[11px] text-zinc-400">{optionalLabel}</span>}
      </div>
      <div ref={triggerRef} className="relative mt-1.5" data-floating-layer data-open={open ? "true" : undefined}>
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          onClick={() => (open ? close() : show())}
          className="tf-deadline-control flex min-h-11 w-full items-center text-left active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-70"
          aria-labelledby={labelId}
          aria-controls={open ? id : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <CalendarDays size={17} className={`ml-3 shrink-0 ${committedStart ? "text-brand-700" : "text-zinc-400"}`} aria-hidden="true" />
          <span className={`min-w-0 flex-1 truncate px-3 text-sm font-medium tabular-nums ${committedStart ? "text-zinc-800" : "text-zinc-400"}`}>
            {summary}
          </span>
          <ChevronDown size={15} className={`mr-3 shrink-0 text-zinc-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </div>
      {helperText && <p className="mt-1.5 text-xs text-zinc-500">{helperText}</p>}

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          id={id}
          role="dialog"
          aria-label={`Chọn ${label.toLowerCase()}`}
          data-floating-layer
          style={style}
          onKeyDown={(event) => trapFocus(event, popoverRef.current)}
          className="tf-scheduling-popover fixed z-[100] overflow-y-auto overscroll-contain rounded-[10px] border border-zinc-200 bg-white"
        >
          <div className="p-3.5">
            <CalendarGrid
              month={month}
              start={draftStart}
              end={draftEnd}
              focused={focused}
              min={minDate}
              selectingEnd={selectingEnd}
              maxEndYearOfStart={maxEndYearOfStart}
              onMonthChange={setMonth}
              onFocusChange={setFocused}
              onSelect={choose}
            />
          </div>
          {!singleDateMode && <div className="border-t border-zinc-100 bg-zinc-50/60 px-3.5 py-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Bắt đầu</span>
                <p className="mt-0.5 text-xs font-semibold tabular-nums text-zinc-800">{formatDate(draftStart) || "Chưa chọn"}</p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Kết thúc</span>
                <p className="mt-0.5 text-xs font-semibold tabular-nums text-zinc-800">
                  {formatDate(draftEnd) || (draftStart && !allowOpenEnd ? formatDate(draftStart) : "Chưa chọn")}
                </p>
              </div>
            </div>
            {selectingEnd && draftStart && (
              <p className="mt-2 text-[10px] text-zinc-500">Chọn ngày kết thúc, hoặc áp dụng để dùng một ngày.</p>
            )}
          </div>}
          <div className="sticky bottom-0 flex min-h-14 items-center gap-2 border-t border-zinc-100 bg-white px-3.5 py-2.5">
            {!required && (draftStart || committedStart) ? (
              <button type="button" onClick={() => commit("", "")} className="mr-auto rounded-[7px] px-2 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-2 focus-visible:outline-brand-500">
                Xóa ngày
              </button>
            ) : (
              <span className="mr-auto" />
            )}
            <button type="button" onClick={() => close(true)} className="min-h-9 rounded-[7px] px-3 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-brand-500">
              {singleDateMode ? "Đóng" : "Hủy"}
            </button>
            {!singleDateMode && (
              <button
                type="button"
                disabled={required && !draftStart}
                onClick={() => commit(draftStart, draftEnd)}
                className="min-h-9 rounded-[7px] bg-brand-500 px-4 text-xs font-semibold text-zinc-950 hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                Áp dụng
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export function DateField({
  label,
  value,
  onChange,
  helperText,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helperText?: string;
  disabled?: boolean;
}) {
  return (
    <DateRangeField
      label={label}
      startValue={value}
      endValue={value}
      onChange={(start) => onChange(start)}
      disabled={disabled}
      allowOpenEnd
      optionalLabel=""
      helperText={helperText}
      singleDateMode
    />
  );
}

function nearestSlot(value: string) {
  const [hourText = "09", minuteText = "00"] = value.split(":");
  const hour = Math.min(23, Math.max(0, Number(hourText) || 0));
  const minute = Number(minuteText) >= 30 ? "30" : "00";
  return `${pad(hour)}:${minute}`;
}

function TimeStepper({
  label,
  value,
  minExclusive,
  onStep,
  onChange,
}: {
  label: string;
  value: string;
  minExclusive?: string;
  onStep: (amount: -1 | 1) => void;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-semibold text-zinc-600">{label}</span>
      <div className="grid grid-cols-[2rem_1fr_2rem] items-center rounded-[7px] border border-zinc-200 bg-white">
        <button type="button" onClick={() => onStep(-1)} className="inline-flex min-h-10 items-center justify-center rounded-l-[6px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-brand-500" aria-label={`Giảm ${label.toLowerCase()} 30 phút`}>
          <Minus size={14} aria-hidden="true" />
        </button>
        <span className="relative border-x border-zinc-100">
          <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-10 w-full cursor-pointer appearance-none bg-transparent px-2 text-center text-xs font-semibold tabular-nums text-zinc-800 outline-none"
            aria-label={label}
          >
            {!HALF_HOUR_SLOTS.includes(value) && <option value={value}>{value}</option>}
            {HALF_HOUR_SLOTS.map((slot) => (
              <option key={slot} value={slot} disabled={Boolean(minExclusive && slot <= minExclusive)}>
                {slot}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
        </span>
        <button type="button" onClick={() => onStep(1)} className="inline-flex min-h-10 items-center justify-center rounded-r-[6px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-brand-500" aria-label={`Tăng ${label.toLowerCase()} 30 phút`}>
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function ScheduleField({
  label,
  date,
  startTime,
  endTime,
  onChange,
  dateName = "date",
  startName = "startTime",
  endName = "endTime",
  disablePast = false,
}: {
  label: string;
  date: string;
  startTime: string;
  endTime: string;
  onChange: (date: string, startTime: string, endTime: string) => void;
  dateName?: string;
  startName?: string;
  endName?: string;
  disablePast?: boolean;
}) {
  const [draftDate, setDraftDate] = useState(date);
  const [draftStart, setDraftStart] = useState(startTime);
  const [draftEnd, setDraftEnd] = useState(endTime);
  const [feedback, setFeedback] = useState("");
  const [validationNow, setValidationNow] = useState(0);
  const [open, setOpen] = useState(false);
  const active = parseDate(date) ?? new Date();
  const [month, setMonth] = useState(new Date(active.getFullYear(), active.getMonth(), 1, 12));
  const [focused, setFocused] = useState(date || todayKey());
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const labelId = useId();
  const style = useFloatingPosition(open, triggerRef, popoverRef, 336, [month, feedback]);

  function close(restoreFocus = false) {
    setOpen(false);
    setFeedback("");
    if (restoreFocus) requestAnimationFrame(() => buttonRef.current?.focus());
  }
  useDismissPopover(open, triggerRef, popoverRef, close);

  function show() {
    const current = parseDate(date) ?? new Date();
    setDraftDate(date || todayKey());
    setDraftStart(startTime);
    setDraftEnd(endTime);
    setMonth(new Date(current.getFullYear(), current.getMonth(), 1, 12));
    setFocused(date || todayKey());
    setFeedback("");
    setValidationNow(Date.now());
    setOpen(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        popoverRef.current
          ?.querySelector<HTMLButtonElement>(`[data-date="${date || todayKey()}"]`)
          ?.focus()
      )
    );
  }

  function step(which: "start" | "end", amount: -1 | 1) {
    const normalizedStart = nearestSlot(draftStart);
    const normalizedEnd = nearestSlot(draftEnd);
    const startIndex = HALF_HOUR_SLOTS.indexOf(normalizedStart);
    const endIndex = Math.max(startIndex + 1, HALF_HOUR_SLOTS.indexOf(normalizedEnd));
    if (which === "start") {
      const duration = Math.max(1, endIndex - startIndex);
      const nextStart = Math.min(HALF_HOUR_SLOTS.length - 2, Math.max(0, startIndex + amount));
      const nextEnd = Math.min(HALF_HOUR_SLOTS.length - 1, nextStart + duration);
      setDraftStart(HALF_HOUR_SLOTS[nextStart]);
      setDraftEnd(HALF_HOUR_SLOTS[nextEnd]);
      setFeedback(`Đã giữ thời lượng ${duration * 30} phút.`);
    } else {
      const nextEnd = Math.min(HALF_HOUR_SLOTS.length - 1, Math.max(startIndex + 1, endIndex + amount));
      if (nextEnd === endIndex && amount < 0) {
        setFeedback("Giờ kết thúc phải sau giờ bắt đầu.");
        return;
      }
      setDraftEnd(HALF_HOUR_SLOTS[nextEnd]);
      setFeedback("");
    }
  }

  function changeTime(which: "start" | "end", value: string) {
    if (which === "end") {
      if (value <= draftStart) {
        setFeedback("Giờ kết thúc phải sau giờ bắt đầu.");
        return;
      }
      setDraftEnd(value);
      setFeedback("");
      return;
    }
    const oldStart = HALF_HOUR_SLOTS.indexOf(nearestSlot(draftStart));
    const oldEnd = Math.max(oldStart + 1, HALF_HOUR_SLOTS.indexOf(nearestSlot(draftEnd)));
    const duration = Math.max(1, oldEnd - oldStart);
    const nextStart = HALF_HOUR_SLOTS.indexOf(value);
    const nextEnd = Math.min(HALF_HOUR_SLOTS.length - 1, nextStart + duration);
    setDraftStart(value);
    setDraftEnd(HALF_HOUR_SLOTS[nextEnd]);
    setFeedback(`Giờ kết thúc tự đổi để giữ thời lượng ${duration * 30} phút.`);
  }

  const past = disablePast && Boolean(
    draftDate &&
      draftStart &&
      validationNow &&
      new Date(`${draftDate}T${draftStart}:00+07:00`).getTime() < validationNow
  );
  const invalidRange = !draftDate || !draftStart || !draftEnd || draftEnd <= draftStart;

  return (
    <div>
      <input type="hidden" name={dateName} value={date} />
      <input type="hidden" name={startName} value={startTime} />
      <input type="hidden" name={endName} value={endTime} />
      <span id={labelId} className="tf-label">{label}</span>
      <div ref={triggerRef} data-floating-layer data-open={open ? "true" : undefined}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => (open ? close() : show())}
          className="tf-deadline-control flex min-h-11 w-full items-center text-left active:scale-[0.99]"
          aria-labelledby={labelId}
          aria-controls={open ? id : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <CalendarDays size={17} className="ml-3 shrink-0 text-brand-700" aria-hidden="true" />
          <span className="min-w-0 flex-1 px-3 py-1">
            <span className="block truncate text-sm font-medium tabular-nums text-zinc-800">{formatDate(date)}</span>
            <span className="block truncate text-[11px] font-medium tabular-nums text-zinc-500">{startTime} – {endTime}</span>
          </span>
          <ChevronDown size={15} className={`mr-3 shrink-0 text-zinc-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          id={id}
          role="dialog"
          aria-label={`Chọn ${label.toLowerCase()}`}
          data-floating-layer
          style={style}
          onKeyDown={(event) => trapFocus(event, popoverRef.current)}
          className="tf-scheduling-popover fixed z-[100] overflow-y-auto overscroll-contain rounded-[10px] border border-zinc-200 bg-white"
        >
          <div className="p-3.5">
            <CalendarGrid
              month={month}
              start={draftDate}
              end=""
              focused={focused}
              min={disablePast ? todayKey() : undefined}
              onMonthChange={setMonth}
              onFocusChange={setFocused}
              onSelect={(value) => {
                setDraftDate(value);
                setFocused(value);
                setFeedback("");
              }}
            />
          </div>
          <div className="border-t border-zinc-100 px-3.5 py-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <TimeStepper
                label="Bắt đầu"
                value={draftStart}
                onStep={(amount) => step("start", amount)}
                onChange={(value) => changeTime("start", value)}
              />
              <TimeStepper
                label="Kết thúc"
                value={draftEnd}
                minExclusive={draftStart}
                onStep={(amount) => step("end", amount)}
                onChange={(value) => changeTime("end", value)}
              />
            </div>
            {(feedback || past) && (
              <p className={`mt-2 text-[10px] leading-4 ${past ? "text-red-600" : "text-zinc-500"}`} aria-live="polite">
                {past ? "Không thể đặt lịch họp trong quá khứ." : feedback}
              </p>
            )}
          </div>
          <div className="sticky bottom-0 flex min-h-14 items-center justify-end gap-2 border-t border-zinc-100 bg-white px-3.5 py-2.5">
            <button type="button" onClick={() => close(true)} className="min-h-9 rounded-[7px] px-3 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-brand-500">Hủy</button>
            <button
              type="button"
              disabled={invalidRange || past}
              onClick={() => {
                onChange(draftDate, draftStart, draftEnd);
                close(true);
              }}
              className="min-h-9 rounded-[7px] bg-brand-500 px-4 text-xs font-semibold text-zinc-950 hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              Áp dụng
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
