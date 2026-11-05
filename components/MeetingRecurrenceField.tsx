"use client";

import { useMemo } from "react";
import { Repeat } from "lucide-react";
import {
  MAX_SERIES_MEETINGS,
  RECURRENCE_FREQUENCIES,
  WEEKDAY_LABELS,
  expandRecurrence,
  isRecurrenceFrequency,
  type RecurrenceRule,
} from "@/lib/meetingRecurrence";
import { rangesOverlap, vnDateTimeToUtc } from "@/lib/meetings";
import { formatDateVN } from "@/lib/dates";

export type RecurrenceValues = {
  repeat: string; // "none" hoặc một RecurrenceFrequency
  repeatDays: number[];
  repeatEnd: "count" | "date";
  repeatCount: string;
  repeatUntil: string;
};

export const NO_RECURRENCE: RecurrenceValues = {
  repeat: "none",
  repeatDays: [],
  repeatEnd: "count",
  repeatCount: "8",
  repeatUntil: "",
};

type Booking = { roomId: string; startAt: string; endAt: string };

const WEEKDAY_NAMES = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** Danh sách các buổi sẽ được tạo từ cấu hình lặp; null nếu không lặp. */
export function previewRecurrence(date: string, values: RecurrenceValues) {
  if (!isRecurrenceFrequency(values.repeat)) return null;
  const rule: RecurrenceRule = {
    frequency: values.repeat,
    weekdays: values.repeatDays,
    end:
      values.repeatEnd === "date"
        ? { type: "date", until: values.repeatUntil }
        : { type: "count", count: Number(values.repeatCount) },
  };
  return expandRecurrence(date, rule);
}

export default function MeetingRecurrenceField({
  values,
  onChange,
  date,
  startTime,
  endTime,
  roomId,
  bookings,
}: {
  values: RecurrenceValues;
  onChange: (next: RecurrenceValues) => void;
  date: string;
  startTime: string;
  endTime: string;
  roomId: string;
  bookings: Booking[];
}) {
  const repeating = isRecurrenceFrequency(values.repeat);
  const needsDays = values.repeat === "weekly" || values.repeat === "biweekly";
  const preview = useMemo(
    () => (repeating ? previewRecurrence(date, values) : null),
    [date, repeating, values]
  );

  const rows = useMemo(() => {
    if (!preview || "error" in preview) return [];
    return preview.dates.map((day) => {
      const startAt = vnDateTimeToUtc(day, startTime);
      const endAt = vnDateTimeToUtc(day, endTime);
      const busy =
        Boolean(roomId) &&
        startAt !== null &&
        endAt !== null &&
        bookings.some(
          (booking) =>
            booking.roomId === roomId &&
            rangesOverlap(startAt, endAt, new Date(booking.startAt), new Date(booking.endAt))
        );
      const weekday = startAt ? WEEKDAY_NAMES[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7] : "";
      return { day, weekday, busy };
    });
  }, [preview, startTime, endTime, roomId, bookings]);

  const busyCount = rows.filter((row) => row.busy).length;
  const days = needsDays
    ? values.repeatDays.length
      ? values.repeatDays
      : [(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]
    : [];

  function patch(next: Partial<RecurrenceValues>) {
    onChange({ ...values, ...next });
  }

  function toggleDay(index: number) {
    const current = days;
    if (current.includes(index)) {
      if (current.length > 1) patch({ repeatDays: current.filter((day) => day !== index) });
    } else {
      patch({ repeatDays: [...current, index].sort() });
    }
  }

  return (
    <fieldset className="rounded-[10px] border border-zinc-200 p-4">
      <input type="hidden" name="repeat" value={values.repeat} />
      <input type="hidden" name="repeatEnd" value={values.repeatEnd} />
      {needsDays && days.map((day) => <input key={day} type="hidden" name="repeatDays" value={day} />)}
      {repeating && values.repeatEnd === "count" && (
        <input type="hidden" name="repeatCount" value={values.repeatCount} />
      )}
      {repeating && values.repeatEnd === "date" && (
        <input type="hidden" name="repeatUntil" value={values.repeatUntil} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Repeat size={18} className="text-zinc-500" aria-hidden="true" />
        <legend className="tf-label !mb-0 float-left">Lặp lại</legend>
        <select
          aria-label="Kiểu lặp lại"
          value={values.repeat}
          onChange={(event) => patch({ repeat: event.target.value })}
          className="tf-field !w-auto min-w-[190px]"
        >
          <option value="none">Không lặp</option>
          {RECURRENCE_FREQUENCIES.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {repeating && (
        <div className="mt-4 space-y-4 border-t border-zinc-100 pt-4">
          {needsDays && (
            <div>
              <span className="tf-label">Vào các thứ</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Các thứ lặp lại">
                {WEEKDAY_LABELS.map((label, index) => {
                  const on = days.includes(index);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(index)}
                      className={`h-8 min-w-11 rounded-full border px-3 text-[13px] transition-colors ${
                        on
                          ? "border-brand-500 bg-brand-400 font-medium text-brand-950"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <span className="tf-label">Kết thúc</span>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={values.repeatEnd === "count"}
                  onChange={() => patch({ repeatEnd: "count" })}
                />
                Sau
              </label>
              <input
                type="number"
                min={2}
                max={MAX_SERIES_MEETINGS}
                inputMode="numeric"
                aria-label="Số buổi"
                value={values.repeatCount}
                disabled={values.repeatEnd !== "count"}
                onChange={(event) => patch({ repeatCount: event.target.value })}
                className="tf-field !w-16 text-center"
              />
              <span>buổi</span>
              <label className="ml-3 flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={values.repeatEnd === "date"}
                  onChange={() => patch({ repeatEnd: "date" })}
                />
                Vào ngày
              </label>
              <input
                type="date"
                aria-label="Ngày kết thúc lặp lại"
                value={values.repeatUntil}
                min={date}
                disabled={values.repeatEnd !== "date"}
                onChange={(event) => patch({ repeatUntil: event.target.value })}
                className="tf-field !w-auto"
              />
            </div>
          </div>

          {preview && "error" in preview ? (
            <p className="text-[13px] text-red-600" role="alert">
              {preview.error}
            </p>
          ) : (
            <div className="rounded-[10px] bg-zinc-50 px-3">
              <ul className="divide-y divide-zinc-200/70">
                {rows.slice(0, 5).map((row) => (
                  <li key={row.day} className="flex items-center justify-between py-2 text-[13px]">
                    <span>
                      {row.weekday}, {formatDateVN(new Date(`${row.day}T00:00:00+07:00`))}
                    </span>
                    {roomId && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          row.busy ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {row.busy ? "Phòng bận · bỏ qua" : "Phòng trống"}
                      </span>
                    )}
                  </li>
                ))}
                {rows.length > 5 && (
                  <li className="py-2 text-[13px] text-zinc-500">và {rows.length - 5} buổi nữa</li>
                )}
              </ul>
            </div>
          )}
          {busyCount > 0 && (
            <p className="text-[13px] text-amber-800">
              {busyCount} buổi bị bỏ qua vì phòng đã có lịch.
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Số buổi sẽ thực sự được đặt (đã trừ buổi phòng bận) — dùng cho nhãn nút gửi. */
export function seriesSubmitCount(
  date: string,
  values: RecurrenceValues,
  startTime: string,
  endTime: string,
  roomId: string,
  bookings: Booking[]
) {
  const preview = previewRecurrence(date, values);
  if (!preview || "error" in preview) return null;
  if (!roomId) return preview.dates.length;
  return preview.dates.filter((day) => {
    const startAt = vnDateTimeToUtc(day, startTime);
    const endAt = vnDateTimeToUtc(day, endTime);
    if (!startAt || !endAt) return true;
    return !bookings.some(
      (booking) =>
        booking.roomId === roomId &&
        rangesOverlap(startAt, endAt, new Date(booking.startAt), new Date(booking.endAt))
    );
  }).length;
}
