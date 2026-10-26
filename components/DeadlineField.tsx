"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";

const HOURS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, "0")
);
const MINUTES = ["00", "30"] as const;
const TIME_OPTIONS = HOURS.flatMap((hour) =>
  MINUTES.map((minute) => `${hour}:${minute}`)
);
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeHalfHour(date: Date): Date {
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

export function toDeadlineLocalValue(iso: string): string {
  const date = normalizeHalfHour(new Date(iso));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function splitValue(value: string) {
  const [date = "", time = ""] = value.split("T");
  const [hour = "09", minute = "00"] = time.split(":");
  return {
    date,
    hour: HOURS.includes(hour) ? hour : "09",
    minute: minute === "30" ? "30" : "00",
  };
}

function composeValue(date: string, hour: string, minute: string): string {
  return date ? `${date}T${hour}:${minute}` : "";
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (
    parsed.getFullYear() !== Number(match[1]) ||
    parsed.getMonth() !== Number(match[2]) - 1 ||
    parsed.getDate() !== Number(match[3])
  ) {
    return null;
  }
  return parsed;
}

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDate(value: string): string {
  const parsed = parseDateInput(value);
  return parsed
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(parsed)
    : "Chọn ngày";
}

function startOfCalendarMonth(month: Date): Date {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  firstDay.setDate(firstDay.getDate() - mondayOffset);
  return firstDay;
}

function splitTwelveHourTime(value: string) {
  const [hourText = "09", minute = "00"] = (value || "09:00").split(":");
  const hour24 = Number(hourText);
  return {
    hour: hour24 % 12 || 12,
    minute: minute === "30" ? "30" : "00",
    period: hour24 >= 12 ? "CH" : "SA",
  } as const;
}

function composeTwelveHourTime(hour: number, minute: string, period: string) {
  const hour24 = (hour % 12) + (period === "CH" ? 12 : 0);
  return `${pad(hour24)}:${minute}`;
}

function formatTwelveHourTime(value: string) {
  if (!value) return "Chưa đặt";
  const time = splitTwelveHourTime(value);
  return `${pad(time.hour)}:${time.minute} ${time.period}`;
}

function TimeSpinner({
  label,
  value,
  disabled,
  compact,
  align = "right",
  optional = false,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  compact: boolean;
  align?: "left" | "right";
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const time = splitTwelveHourTime(value);

  function change(partial: Partial<typeof time>) {
    const next = { ...time, ...partial };
    onChange(composeTwelveHourTime(next.hour, next.minute, next.period));
  }

  function stepHour(amount: number) {
    change({ hour: ((time.hour - 1 + amount + 12) % 12) + 1 });
  }

  function stepMinute() {
    change({ minute: time.minute === "00" ? "30" : "00" });
  }

  function togglePeriod() {
    change({ period: time.period === "SA" ? "CH" : "SA" });
  }

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={pickerRef} className="relative min-w-0" data-floating-layer>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`tf-deadline-control flex w-full items-center text-left disabled:cursor-not-allowed disabled:bg-zinc-50/80 disabled:opacity-70 ${
          compact ? "min-h-9" : "min-h-10"
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 py-1 pl-2.5 pr-1">
          <span className="block text-[8px] font-semibold uppercase tracking-[0.05em] text-zinc-400">
            {label}
          </span>
          <span className="block whitespace-nowrap text-xs font-semibold tabular-nums text-zinc-800">
            {formatTwelveHourTime(value)}
          </span>
        </span>
        <ChevronDown
          size={12}
          className={`mr-1.5 shrink-0 text-zinc-400 transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Chọn ${label.toLowerCase()}`}
          className={`tf-time-spinner absolute top-full z-40 mt-1.5 w-[12.5rem] rounded-[10px] border border-white/80 bg-white/95 p-2.5 backdrop-blur-xl ${
            align === "left" ? "left-0" : "right-0"
          }`}
        >
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1 text-center">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Giờ
            </span>
            <span aria-hidden="true" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Phút
            </span>
            <span aria-hidden="true" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Buổi
            </span>

            <button type="button" onClick={() => stepHour(1)} className="tf-time-step" aria-label="Tăng giờ">
              <ChevronUp size={17} aria-hidden="true" />
            </button>
            <span aria-hidden="true" />
            <button type="button" onClick={stepMinute} className="tf-time-step" aria-label="Tăng phút">
              <ChevronUp size={17} aria-hidden="true" />
            </button>
            <span aria-hidden="true" />
            <button type="button" onClick={togglePeriod} className="tf-time-step" aria-label="Đổi buổi">
              <ChevronUp size={17} aria-hidden="true" />
            </button>

            <span className="tf-time-value">{pad(time.hour)}</span>
            <span className="font-semibold text-zinc-300" aria-hidden="true">:</span>
            <span className="tf-time-value">{time.minute}</span>
            <span className="font-semibold text-zinc-300" aria-hidden="true" />
            <span className="tf-time-value">{time.period}</span>

            <button type="button" onClick={() => stepHour(-1)} className="tf-time-step" aria-label="Giảm giờ">
              <ChevronDown size={17} aria-hidden="true" />
            </button>
            <span aria-hidden="true" />
            <button type="button" onClick={stepMinute} className="tf-time-step" aria-label="Giảm phút">
              <ChevronDown size={17} aria-hidden="true" />
            </button>
            <span aria-hidden="true" />
            <button type="button" onClick={togglePeriod} className="tf-time-step" aria-label="Đổi buổi">
              <ChevronDown size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-2.5 flex gap-2 border-t border-zinc-100 pt-2.5">
            {optional && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="min-h-8 flex-1 rounded-full bg-zinc-100 px-3 text-xs font-medium text-zinc-600 transition-colors duration-300 hover:bg-zinc-200"
              >
                Bỏ giờ
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-8 flex-1 rounded-full bg-brand-500 px-3 text-xs font-semibold text-zinc-950 transition-colors duration-300 hover:bg-brand-600"
            >
              Xong
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DeadlineField({
  name,
  startName,
  label = "Thời gian thực hiện",
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
  const [startTime, setStartTime] = useState(
    initialStart.date
      ? `${initialStart.hour}:${initialStart.minute}`
      : initialDateValue
        ? ""
        : "09:00"
  );
  const [endTime, setEndTime] = useState(
    initialEnd.date ? `${initialEnd.hour}:${initialEnd.minute}` : "09:30"
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(
    new Date(initialDate.getFullYear(), initialDate.getMonth(), 1, 12)
  );
  const labelId = useId();
  const calendarRef = useRef<HTMLDivElement>(null);

  function update(nextDate: string, nextStartTime: string, nextEndTime: string) {
    if (nextDate) {
      const [endHour, endMinute] = nextEndTime.split(":");
      onChange?.(composeValue(nextDate, endHour, endMinute));
      if (nextStartTime) {
        const [startHour, startMinute] = nextStartTime.split(":");
        onStartChange?.(composeValue(nextDate, startHour, startMinute));
      } else {
        onStartChange?.("");
      }
    } else {
      onChange?.("");
      onStartChange?.("");
    }
  }

  function chooseDate(nextDate: Date) {
    const nextValue = toDateInput(nextDate);
    const nextStartTime = startTime || "09:00";
    const nextEndTime = endTime > nextStartTime ? endTime : "09:30";
    setDate(nextValue);
    setStartTime(nextStartTime);
    setEndTime(nextEndTime);
    setCalendarMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1, 12));
    update(nextValue, nextStartTime, nextEndTime);
  }

  const [endHour, endMinute] = endTime.split(":");
  const [startHour, startMinute] = startTime.split(":");
  const composedValue = composeValue(date, endHour, endMinute);
  const composedStartValue = startTime
    ? composeValue(date, startHour, startMinute)
    : "";
  const selectedDate = parseDateInput(date);
  const todayValue = toDateInput(new Date());
  const controlHeight = compact ? "min-h-10" : "min-h-11";
  const calendarDays = useMemo(() => {
    const start = startOfCalendarMonth(calendarMonth);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [calendarMonth]);

  useEffect(() => {
    if (!calendarOpen) return;

    function closeCalendar(event: PointerEvent) {
      if (!calendarRef.current?.contains(event.target as Node)) {
        setCalendarOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setCalendarOpen(false);
    }

    document.addEventListener("pointerdown", closeCalendar, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeCalendar, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [calendarOpen]);

  return (
    <div className={className}>
      {name && <input type="hidden" name={name} value={composedValue} />}
      {startName && (
        <input type="hidden" name={startName} value={composedStartValue} />
      )}
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-xs font-medium text-zinc-500">
          {label}
        </span>
        <span className="text-[11px] text-zinc-400">Không bắt buộc</span>
      </div>

      <div className="mt-1.5 space-y-2" role="group" aria-labelledby={labelId}>
        <div ref={calendarRef} className="relative" data-floating-layer>
          <button
            type="button"
            onClick={() => {
              const activeDate = selectedDate ?? new Date();
              setCalendarMonth(
                new Date(activeDate.getFullYear(), activeDate.getMonth(), 1, 12)
              );
              setCalendarOpen((open) => !open);
            }}
            className={`tf-deadline-control flex w-full items-center text-left ${controlHeight}`}
            aria-haspopup="dialog"
            aria-expanded={calendarOpen}
          >
            <CalendarDays
              size={17}
              className={`ml-3 shrink-0 ${date ? "text-brand-700" : "text-zinc-400"}`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 px-3 py-1">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
                Ngày
              </span>
              <span
                className={`block truncate text-sm font-medium tabular-nums ${
                  date ? "text-zinc-800" : "text-zinc-400"
                }`}
              >
                {formatDate(date)}
              </span>
            </span>
            <ChevronDown
              size={15}
              className={`mr-3 shrink-0 text-zinc-400 transition-transform ${
                calendarOpen ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          </button>

          {calendarOpen && (
            <div
              role="dialog"
              aria-label="Chọn ngày hạn chót"
              className="tf-deadline-calendar absolute left-0 top-full z-30 mt-2 w-full min-w-[15rem] rounded-xl border border-zinc-200 bg-white p-3"
            >
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-sm font-semibold capitalize text-zinc-800">
                  {new Intl.DateTimeFormat("vi-VN", {
                    month: "long",
                    year: "numeric",
                  }).format(calendarMonth)}
                </p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setCalendarMonth(
                        new Date(
                          calendarMonth.getFullYear(),
                          calendarMonth.getMonth() - 1,
                          1,
                          12
                        )
                      )
                    }
                    className="inline-flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-2 focus-visible:outline-brand-500"
                    aria-label="Tháng trước"
                  >
                    <ChevronLeft size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCalendarMonth(
                        new Date(
                          calendarMonth.getFullYear(),
                          calendarMonth.getMonth() + 1,
                          1,
                          12
                        )
                      )
                    }
                    className="inline-flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-2 focus-visible:outline-brand-500"
                    aria-label="Tháng sau"
                  >
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-7 gap-y-1 text-center">
                {WEEKDAYS.map((weekday) => (
                  <span
                    key={weekday}
                    className="pb-1 text-[10px] font-semibold text-zinc-400"
                  >
                    {weekday}
                  </span>
                ))}
                {calendarDays.map((day) => {
                  const dayValue = toDateInput(day);
                  const isSelected = Boolean(selectedDate && dayValue === date);
                  const isToday = dayValue === todayValue;
                  const isOutsideMonth = day.getMonth() !== calendarMonth.getMonth();

                  return (
                    <button
                      key={dayValue}
                      type="button"
                      onClick={() => chooseDate(day)}
                      className={`mx-auto inline-flex size-7 items-center justify-center rounded-full text-[11px] font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 ${
                        isSelected
                          ? "bg-brand-500 text-zinc-950 shadow-sm"
                          : isToday
                            ? "ring-1 ring-inset ring-brand-500 text-brand-800"
                            : isOutsideMonth
                              ? "text-zinc-300 hover:bg-zinc-50 hover:text-zinc-500"
                              : "text-zinc-700 hover:bg-brand-50 hover:text-brand-800"
                      }`}
                      aria-label={new Intl.DateTimeFormat("vi-VN", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      }).format(day)}
                      aria-pressed={isSelected}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex gap-2 border-t border-zinc-100 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setDate("");
                    update("", startTime, endTime);
                    setCalendarOpen(false);
                  }}
                  disabled={!date}
                  className="min-h-8 flex-1 rounded-full bg-zinc-100 px-3 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Xoá hạn
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarOpen(false)}
                  className="min-h-8 flex-1 rounded-full bg-brand-500 px-3 text-xs font-semibold text-zinc-950 transition-colors hover:bg-brand-600"
                >
                  Xong
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <TimeSpinner
            label="Bắt đầu"
            value={startTime}
            disabled={!date}
            compact={compact}
            align="left"
            optional
            onChange={(nextStartTime) => {
              if (nextStartTime === "23:30") return;
              let nextEndTime = endTime;
              if (nextStartTime && nextEndTime <= nextStartTime) {
                const nextIndex = TIME_OPTIONS.indexOf(nextStartTime) + 1;
                nextEndTime = TIME_OPTIONS[nextIndex] ?? "23:30";
                setEndTime(nextEndTime);
              }
              setStartTime(nextStartTime);
              update(date, nextStartTime, nextEndTime);
            }}
          />
          <TimeSpinner
            label="Kết thúc"
            value={endTime}
            disabled={!date}
            compact={compact}
            onChange={(nextEndTime) => {
              if (startTime && nextEndTime <= startTime) return;
              setEndTime(nextEndTime);
              update(date, startTime, nextEndTime);
            }}
          />
        </div>
      </div>
    </div>
  );
}
