"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";

const HOURS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, "0")
);
const MINUTES = ["00", "30"] as const;

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

export default function DeadlineField({
  name,
  label = "Hạn chót",
  value,
  defaultValue = "",
  onChange,
  className = "",
  compact = false,
}: {
  name?: string;
  label?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
  compact?: boolean;
}) {
  const initial = splitValue(value ?? defaultValue);
  const [date, setDate] = useState(initial.date);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);

  function update(nextDate: string, nextHour: string, nextMinute: string) {
    if (nextDate) onChange?.(composeValue(nextDate, nextHour, nextMinute));
    else onChange?.("");
  }

  const composedValue = composeValue(date, hour, minute);

  return (
    <div className={className}>
      {name && <input type="hidden" name={name} value={composedValue} />}
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <div
        className={`tf-deadline-group mt-1 grid overflow-hidden ${
          compact
            ? "grid-cols-[3rem_repeat(2,minmax(0,1fr))]"
            : "grid-cols-[3.25rem_repeat(2,minmax(0,1fr))]"
        }`}
      >
        <div
          className={`relative flex min-w-0 cursor-pointer items-center justify-center border-r border-zinc-200 transition-colors hover:bg-zinc-50 ${
            date ? "bg-brand-50/60" : "bg-white"
          }`}
        >
          <CalendarDays
            size={16}
            className={`pointer-events-none shrink-0 ${
              date ? "text-brand-700" : "text-zinc-500"
            }`}
            aria-hidden="true"
          />
          <input
            type="date"
            value={date}
            onChange={(event) => {
              const nextDate = event.target.value;
              setDate(nextDate);
              update(nextDate, hour, minute);
            }}
            onClick={(event) => event.currentTarget.showPicker?.()}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Ngày hết hạn"
            title={date ? `Ngày hết hạn: ${date}` : "Chọn ngày hết hạn"}
          />
        </div>
        <div className="relative min-w-0 border-r border-zinc-200 bg-white transition-colors hover:bg-zinc-50">
          <select
            value={hour}
            onChange={(event) => {
              const nextHour = event.target.value;
              setHour(nextHour);
              update(date, nextHour, minute);
            }}
            className="h-full min-h-11 w-full appearance-none bg-transparent pl-3 pr-9 text-center text-sm font-medium tabular-nums text-zinc-800 outline-none"
            aria-label="Giờ"
            title="Giờ"
          >
            {HOURS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <ChevronDown
            size={15}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
        </div>
        <div className="relative min-w-0 bg-white transition-colors hover:bg-zinc-50">
          <select
            value={minute}
            onChange={(event) => {
              const nextMinute = event.target.value;
              setMinute(nextMinute);
              update(date, hour, nextMinute);
            }}
            className="h-full min-h-11 w-full appearance-none bg-transparent pl-3 pr-9 text-center text-sm font-medium tabular-nums text-zinc-800 outline-none"
            aria-label="Phút"
            title="Phút"
          >
            {MINUTES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <ChevronDown
            size={15}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
