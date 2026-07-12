"use client";

import { useState } from "react";

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
}: {
  name?: string;
  label?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
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
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_4.75rem_4.25rem] gap-2">
        <input
          type="date"
          value={date}
          onChange={(event) => {
            const nextDate = event.target.value;
            setDate(nextDate);
            update(nextDate, hour, minute);
          }}
          className="tf-field !min-h-9 !py-1.5"
        />
        <select
          value={hour}
          onChange={(event) => {
            const nextHour = event.target.value;
            setHour(nextHour);
            update(date, nextHour, minute);
          }}
          className="tf-field !min-h-9 !py-1.5"
          aria-label="Giờ"
        >
          {HOURS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={minute}
          onChange={(event) => {
            const nextMinute = event.target.value;
            setMinute(nextMinute);
            update(date, hour, nextMinute);
          }}
          className="tf-field !min-h-9 !py-1.5"
          aria-label="Phút"
        >
          {MINUTES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
