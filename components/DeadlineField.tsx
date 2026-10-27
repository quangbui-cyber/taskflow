"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const TIMES = HOURS.flatMap((hour) => ["00", "30"].map((minute) => `${hour}:${minute}`));
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function normalizeHalfHour(date: Date) {
  const normalized = new Date(date);
  const minutes = normalized.getMinutes();
  normalized.setSeconds(0, 0);
  if (minutes < 15) normalized.setMinutes(0);
  else if (minutes < 45) normalized.setMinutes(30);
  else {
    normalized.setHours(normalized.getHours() + 1);
    normalized.setMinutes(0);
  }
  return normalized;
}

export function toDeadlineLocalValue(iso: string) {
  const date = normalizeHalfHour(new Date(iso));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function splitValue(value: string) {
  const [date = "", time = ""] = value.split("T");
  const [hour = "09", minute = "00"] = time.split(":");
  return { date, time: `${HOURS.includes(hour) ? hour : "09"}:${minute === "30" ? "30" : "00"}` };
}

function composeValue(date: string, time: string) {
  return date && time ? `${date}T${time}` : "";
}

function parseDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return parsed.getFullYear() === Number(match[1]) &&
    parsed.getMonth() === Number(match[2]) - 1 &&
    parsed.getDate() === Number(match[3])
    ? parsed
    : null;
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDate(value: string) {
  const parsed = parseDateInput(value);
  return parsed
    ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed)
    : "Chọn ngày";
}

function formatMonth(value: Date) {
  const formatted = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(value);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function startOfCalendarMonth(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  firstDay.setDate(firstDay.getDate() - ((firstDay.getDay() + 6) % 7));
  return firstDay;
}

function formatTime(value: string) {
  if (!value) return "Chưa đặt";
  const [hourText = "09", minute = "00"] = value.split(":");
  const hour = Number(hourText);
  return `${pad(hour % 12 || 12)}:${minute} ${hour >= 12 ? "CH" : "SA"}`;
}

function formatDuration(slots: number) {
  const minutes = Math.max(1, slots) * 30;
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} giờ ${minutes % 60} phút` : `${hours} giờ`;
}

type FloatingPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  ready: boolean;
};

function InlineTimeControl({
  label,
  value,
  optional,
  onStep,
  onClear,
}: {
  label: string;
  value: string;
  optional?: boolean;
  onStep: (amount: -1 | 1) => void;
  onClear?: () => void;
}) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (["ArrowUp", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      onStep(1);
    } else if (["ArrowDown", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      onStep(-1);
    }
  }

  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2.5">
      <div className="flex min-h-4 items-center gap-2">
        <span className="text-[11px] font-semibold text-zinc-600">{label}</span>
      </div>
      <div
        role="group"
        aria-label={`Chọn ${label.toLowerCase()}`}
        onKeyDown={handleKeyDown}
        className="grid grid-cols-[2.25rem_1fr_2.25rem] items-center rounded-[7px] border border-zinc-200 bg-white"
      >
        <button
          type="button"
          onClick={() => onStep(-1)}
          className="inline-flex min-h-9 items-center justify-center rounded-l-[6px] text-zinc-400 transition-[background-color,color,transform] duration-150 hover:bg-zinc-100 hover:text-zinc-700 active:scale-[0.98] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-brand-500"
          aria-label={`Giảm ${label.toLowerCase()} 30 phút`}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <span className="flex min-w-0 items-center justify-center gap-1 border-x border-zinc-100 px-1 text-center text-xs font-semibold tabular-nums text-zinc-800">
          <span className="truncate">{formatTime(value)}</span>
          {optional && value && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-brand-500"
              aria-label="Bỏ giờ bắt đầu"
              title="Bỏ giờ bắt đầu"
            >
              <X size={11} aria-hidden="true" />
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={() => onStep(1)}
          className="inline-flex min-h-9 items-center justify-center rounded-r-[6px] text-zinc-400 transition-[background-color,color,transform] duration-150 hover:bg-zinc-100 hover:text-zinc-700 active:scale-[0.98] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-brand-500"
          aria-label={`Tăng ${label.toLowerCase()} 30 phút`}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function DeadlineField({
  name,
  startName,
  label = "Hạn chót",
  value,
  startValue,
  defaultValue = "",
  defaultStartValue = "",
  onChange,
  onStartChange,
  className = "",
  compact = false,
}: {
  name?: string;
  startName?: string;
  label?: string;
  value?: string;
  startValue?: string;
  defaultValue?: string;
  defaultStartValue?: string;
  onChange?: (value: string) => void;
  onStartChange?: (value: string) => void;
  className?: string;
  compact?: boolean;
}) {
  const initialEnd = splitValue(value ?? defaultValue);
  const initialStart = splitValue(startValue ?? defaultStartValue);
  const initialDateValue = initialEnd.date || initialStart.date;
  const initialDate = parseDateInput(initialDateValue) ?? new Date();
  const [date, setDate] = useState(initialDateValue);
  const [startTime, setStartTime] = useState(initialStart.date ? initialStart.time : "");
  const [endTime, setEndTime] = useState(initialEnd.date ? initialEnd.time : "17:00");
  const [draftDate, setDraftDate] = useState(date);
  const [draftStartTime, setDraftStartTime] = useState(startTime);
  const [draftEndTime, setDraftEndTime] = useState(endTime);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1, 12));
  const [focusedDate, setFocusedDate] = useState(initialDateValue || toDateInput(new Date()));
  const [feedback, setFeedback] = useState("");
  const labelId = useId();
  const pickerId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarGridRef = useRef<HTMLDivElement>(null);
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition>({
    top: 16,
    left: 16,
    width: 336,
    maxHeight: 0,
    ready: false,
  });

  const calendarDays = useMemo(() => {
    const start = startOfCalendarMonth(calendarMonth);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [calendarMonth]);

  function openPicker() {
    const activeDate = parseDateInput(date) ?? new Date();
    setDraftDate(date);
    setDraftStartTime(startTime);
    setDraftEndTime(endTime || "17:00");
    setCalendarMonth(new Date(activeDate.getFullYear(), activeDate.getMonth(), 1, 12));
    setFocusedDate(date || toDateInput(activeDate));
    setFeedback("");
    setPickerOpen(true);
  }

  function closePicker(restoreFocus = false) {
    setPickerOpen(false);
    setFeedback("");
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function applyDraft() {
    setDate(draftDate);
    if (draftDate) {
      setStartTime(draftStartTime);
      setEndTime(draftEndTime);
      onChange?.(composeValue(draftDate, draftEndTime));
      onStartChange?.(composeValue(draftDate, draftStartTime));
    } else {
      onChange?.("");
      onStartChange?.("");
    }
    closePicker(true);
  }

  function chooseDate(nextDate: Date) {
    const nextValue = toDateInput(nextDate);
    setDraftDate(nextValue);
    setFocusedDate(nextValue);
    setCalendarMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1, 12));
    setFeedback("");
  }

  function focusCalendarDate(nextDate: Date) {
    const nextValue = toDateInput(nextDate);
    setFocusedDate(nextValue);
    setCalendarMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1, 12));
    requestAnimationFrame(() => {
      calendarGridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${nextValue}"]`)?.focus();
    });
  }

  function handleCalendarKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, day: Date) {
    let amount = 0;
    if (event.key === "ArrowLeft") amount = -1;
    if (event.key === "ArrowRight") amount = 1;
    if (event.key === "ArrowUp") amount = -7;
    if (event.key === "ArrowDown") amount = 7;
    if (event.key === "Home") amount = -((day.getDay() + 6) % 7);
    if (event.key === "End") amount = 6 - ((day.getDay() + 6) % 7);
    if (amount) {
      event.preventDefault();
      const next = new Date(day);
      next.setDate(day.getDate() + amount);
      focusCalendarDate(next);
    } else if (["PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault();
      const next = new Date(day);
      next.setMonth(day.getMonth() + (event.key === "PageUp" ? -1 : 1));
      focusCalendarDate(next);
    }
  }

  function trapPopoverFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      popoverRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function stepStart(amount: -1 | 1) {
    const currentStart = Math.max(0, TIMES.indexOf(draftStartTime || "09:00"));
    const currentEnd = Math.max(currentStart + 1, TIMES.indexOf(draftEndTime));
    const duration = Math.max(1, currentEnd - currentStart);
    const nextStart = Math.min(TIMES.length - 2, Math.max(0, currentStart + amount));
    const desiredEnd = nextStart + duration;
    const nextEnd = Math.min(TIMES.length - 1, desiredEnd);
    setDraftStartTime(TIMES[nextStart]);
    setDraftEndTime(TIMES[nextEnd]);
    setFeedback(
      desiredEnd === nextEnd
        ? `Giờ kết thúc tự đổi để giữ thời lượng ${formatDuration(duration)}.`
        : "Giờ kết thúc đã đặt thành 11:30 CH; thời lượng được rút ngắn."
    );
  }

  function stepEnd(amount: -1 | 1) {
    const startIndex = draftStartTime ? TIMES.indexOf(draftStartTime) : -1;
    const currentEnd = Math.max(0, TIMES.indexOf(draftEndTime));
    const nextEnd = Math.min(TIMES.length - 1, Math.max(startIndex + 1, currentEnd + amount));
    if (nextEnd === currentEnd && amount < 0 && startIndex >= 0) {
      setFeedback("Giờ kết thúc phải sau giờ bắt đầu.");
      return;
    }
    setDraftEndTime(TIMES[nextEnd]);
    setFeedback("");
  }

  function enableStartTime() {
    const endIndex = TIMES.indexOf(draftEndTime);
    const startIndex = endIndex > 0 ? endIndex - 1 : TIMES.indexOf("09:00");
    setDraftStartTime(TIMES[Math.max(0, startIndex)] ?? "09:00");
    setFeedback("");
  }

  useEffect(() => {
    if (!pickerOpen) return;
    function closeOnOutsidePress(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !pickerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setPickerOpen(false);
        setFeedback("");
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPickerOpen(false);
        setFeedback("");
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pickerOpen]);

  useLayoutEffect(() => {
    if (!pickerOpen) return;

    function positionPopover() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;

      const viewportPadding = 16;
      const gap = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(336, viewportWidth - viewportPadding * 2);
      const naturalHeight = popover.scrollHeight;
      const triggerRect = trigger.getBoundingClientRect();

      if (viewportWidth < 640) {
        const maxHeight = viewportHeight - viewportPadding * 2;
        const height = Math.min(naturalHeight, maxHeight);
        setFloatingPosition({
          top: viewportHeight - viewportPadding - height,
          left: viewportPadding,
          width,
          maxHeight,
          ready: true,
        });
        return;
      }

      const availableBelow = viewportHeight - triggerRect.bottom - gap - viewportPadding;
      const availableAbove = triggerRect.top - gap - viewportPadding;
      const fitsBelow = naturalHeight <= availableBelow;
      const fitsAbove = naturalHeight <= availableAbove;
      const openAbove = !fitsBelow && (fitsAbove || availableAbove > availableBelow);
      const maxHeight = Math.max(0, openAbove ? availableAbove : availableBelow);
      const height = Math.min(naturalHeight, maxHeight);
      const top = openAbove
        ? Math.max(viewportPadding, triggerRect.top - gap - height)
        : triggerRect.bottom + gap;
      const preferredLeft = triggerRect.right - width;
      const left = Math.min(
        viewportWidth - viewportPadding - width,
        Math.max(viewportPadding, preferredLeft)
      );

      setFloatingPosition({ top, left, width, maxHeight, ready: true });
    }

    positionPopover();
    const resizeObserver = new ResizeObserver(positionPopover);
    if (popoverRef.current) resizeObserver.observe(popoverRef.current);
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [pickerOpen, calendarMonth, feedback]);

  useEffect(() => {
    if (!pickerOpen || !floatingPosition.ready) return;
    requestAnimationFrame(() => {
      calendarGridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`)
        ?.focus();
    });
  }, [pickerOpen, floatingPosition.ready, focusedDate]);

  const selectedDraftDate = parseDateInput(draftDate);
  const todayValue = toDateInput(new Date());
  const timeSummary = date
    ? startTime
      ? `${formatTime(startTime)} – ${formatTime(endTime)}`
      : `Hạn chót ${formatTime(endTime)}`
    : "Chọn ngày và giờ phải hoàn thành";

  return (
    <div className={className}>
      {name && <input type="hidden" name={name} value={composeValue(date, endTime)} />}
      {startName && <input type="hidden" name={startName} value={composeValue(date, startTime)} />}
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-xs font-medium text-zinc-500">{label}</span>
        <span className="text-[11px] text-zinc-400">Không bắt buộc</span>
      </div>

      <div
        ref={pickerRef}
        className="relative mt-1.5"
        data-floating-layer
        data-open={pickerOpen ? "true" : undefined}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (pickerOpen ? closePicker() : openPicker())}
          className={`tf-deadline-control flex w-full items-center text-left active:scale-[0.99] ${compact ? "min-h-10" : "min-h-11"}`}
          aria-labelledby={labelId}
          aria-controls={pickerOpen ? pickerId : undefined}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
        >
          <CalendarDays size={17} className={`ml-3 shrink-0 ${date ? "text-brand-700" : "text-zinc-400"}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 px-3 py-1">
            <span className={`block truncate text-sm font-medium tabular-nums ${date ? "text-zinc-800" : "text-zinc-500"}`}>
              {formatDate(date)}
            </span>
            <span className="block truncate text-[11px] tabular-nums text-zinc-400">{timeSummary}</span>
          </span>
          <ChevronDown size={15} className={`mr-3 shrink-0 text-zinc-400 transition-transform duration-150 ${pickerOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {pickerOpen && typeof document !== "undefined" && createPortal(
          <div
            ref={popoverRef}
            id={pickerId}
            role="dialog"
            aria-label="Chọn hạn chót"
            data-floating-layer
            onKeyDown={trapPopoverFocus}
            style={{
              top: floatingPosition.top,
              left: floatingPosition.left,
              width: floatingPosition.width,
              maxHeight: floatingPosition.maxHeight || undefined,
              visibility: floatingPosition.ready ? "visible" : "hidden",
            }}
            className="tf-scheduling-popover fixed z-[60] overflow-y-auto overscroll-contain rounded-[10px] border border-zinc-200 bg-white"
          >
            <div className="p-3.5">
              <div className="flex items-center justify-between gap-2 px-0.5">
                <p className="text-sm font-semibold text-zinc-800">{formatMonth(calendarMonth)}</p>
                <div className="flex gap-1">
                  {[-1, 1].map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + direction, 1, 12))}
                      className="inline-flex size-8 items-center justify-center rounded-[7px] text-zinc-600 transition-[background-color,color,transform] duration-150 hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand-500"
                      aria-label={direction < 0 ? "Tháng trước" : "Tháng sau"}
                    >
                      {direction < 0 ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>

              <div ref={calendarGridRef} className="mt-3 grid grid-cols-7 gap-1 text-center" role="grid" aria-label={formatMonth(calendarMonth)}>
                {WEEKDAYS.map((weekday) => (
                  <span key={weekday} role="columnheader" className="flex h-6 items-center justify-center text-[10px] font-semibold text-zinc-500">{weekday}</span>
                ))}
                {calendarDays.map((day) => {
                  const dayValue = toDateInput(day);
                  const selected = Boolean(selectedDraftDate && dayValue === draftDate);
                  const today = dayValue === todayValue;
                  const outside = day.getMonth() !== calendarMonth.getMonth();
                  return (
                    <button
                      key={dayValue}
                      type="button"
                      data-date={dayValue}
                      role="gridcell"
                      tabIndex={dayValue === focusedDate ? 0 : -1}
                      onFocus={() => setFocusedDate(dayValue)}
                      onKeyDown={(event) => handleCalendarKeyDown(event, day)}
                      onClick={() => chooseDate(day)}
                      className={`relative mx-auto inline-flex size-8 items-center justify-center rounded-[7px] text-xs font-medium tabular-nums transition-[background-color,color,transform] duration-150 active:scale-[0.98] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 ${
                        selected ? "bg-brand-500 text-zinc-950" : outside ? "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500" : "text-zinc-700 hover:bg-zinc-100"
                      }`}
                      aria-label={new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(day)}
                      aria-selected={selected}
                    >
                      {day.getDate()}
                      {today && !selected && <span className="absolute bottom-0.5 size-1 rounded-full bg-brand-600" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-zinc-100 px-3.5 py-2.5">
              {draftStartTime ? (
                <div className="space-y-2">
                  <InlineTimeControl
                    label="Bắt đầu"
                    value={draftStartTime}
                    optional
                    onClear={() => {
                      setDraftStartTime("");
                      setFeedback("");
                    }}
                    onStep={stepStart}
                  />
                  <InlineTimeControl label="Kết thúc" value={draftEndTime} onStep={stepEnd} />
                </div>
              ) : (
                <div>
                  <InlineTimeControl label="Hạn chót" value={draftEndTime} onStep={stepEnd} />
                  <button
                    type="button"
                    onClick={enableStartTime}
                    className="ml-[4.875rem] mt-2 inline-flex min-h-8 w-[calc(100%_-_4.875rem)] items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-zinc-200 bg-zinc-50 px-2 text-[11px] font-semibold text-zinc-600 transition-[background-color,border-color,color,transform] duration-150 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand-500"
                  >
                    <Plus size={13} aria-hidden="true" />
                    Thêm giờ bắt đầu
                  </button>
                </div>
              )}
              <div aria-live="polite">
                {feedback && (
                  <p className="mt-2 text-[10px] leading-4 text-zinc-500">{feedback}</p>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 z-10 flex min-h-14 items-center gap-2 border-t border-zinc-100 bg-white px-3.5 py-2.5">
              {draftDate || date ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraftDate("");
                    setFeedback("");
                  }}
                  className="mr-auto rounded-[7px] px-2 py-2 text-xs font-medium text-zinc-500 transition-[background-color,color,transform] duration-150 hover:bg-zinc-100 hover:text-zinc-800 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  Xóa hạn
                </button>
              ) : (
                <span className="mr-auto" />
              )}
              <button
                type="button"
                onClick={() => closePicker(true)}
                className="min-h-9 rounded-[7px] px-3 text-xs font-semibold text-zinc-600 transition-[background-color,transform] duration-150 hover:bg-zinc-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={applyDraft}
                className="min-h-9 rounded-[7px] bg-brand-500 px-4 text-xs font-semibold text-zinc-950 transition-[background-color,transform] duration-150 hover:bg-brand-600 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
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
