"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown } from "lucide-react";

export default function RecognitionMonthSelect({
  value,
  options,
  compact = false,
}: {
  value: string;
  options: Array<{ key: string; label: string }>;
  compact?: boolean;
}) {
  const router = useRouter();

  return (
    <label className={`relative flex items-center gap-2 text-zinc-500 ${compact ? "w-full" : ""}`}>
      <CalendarDays size={15} className="pointer-events-none shrink-0" aria-hidden="true" />
      <span className="sr-only">Chọn tháng</span>
      <select
        value={value}
        onChange={(event) => {
          const params = new URLSearchParams(window.location.search);
          params.set("month", event.target.value);
          params.delete("focus");
          router.push(`/recognition?${params.toString()}`);
        }}
        className={`min-h-10 cursor-pointer appearance-none bg-transparent pr-7 text-sm outline-none ${compact ? "min-w-0 flex-1" : ""}`}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-1 text-zinc-400"
        aria-hidden="true"
      />
    </label>
  );
}
