"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import Avatar from "@/components/Avatar";
import { matchesPerson, type SearchablePerson } from "@/lib/peopleSearch";

export default function PersonSearchSelect({
  people, value, onChange, disabled = false,
}: {
  people: SearchablePerson[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = people.find((person) => person.id === value);
  const filtered = people.filter((person) => matchesPerson(person, query));

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div ref={container} onBlur={(event) => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <span id={`${id}-label`} className="mb-2 block text-sm font-semibold text-zinc-800">Gửi đến</span>
      <button ref={trigger} type="button" disabled={disabled} aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open && !disabled} aria-controls={`${id}-picker`}
        className="tf-field flex items-center gap-2 text-left"
        onClick={() => { setOpen(!open); setQuery(""); }}>
        {selected && <Avatar {...selected} className="h-7 w-7 text-xs" />}
        <span id={`${id}-value`} className={`min-w-0 flex-1 truncate ${selected ? "" : "text-zinc-500"}`}>
          {selected?.name ?? "Chọn một đồng nghiệp"}
        </span>
        <ChevronDown size={16} className="shrink-0 text-zinc-500" aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div id={`${id}-picker`} className="mt-2 rounded-[14px] border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="relative">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              aria-label="Tìm người nhận lời cảm ơn" placeholder="Tìm theo tên hoặc email…"
              className="tf-field !pl-10" autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  container.current?.querySelector<HTMLButtonElement>("[data-person-option]")?.focus();
                }
              }} />
          </div>
          <div role="group" aria-label="Đồng nghiệp phù hợp" className="mt-2 max-h-60 overflow-y-auto">
            {filtered.map((person) => (
              <button key={person.id} type="button" data-person-option aria-pressed={person.id === value}
                onClick={() => { onChange(person.id); setOpen(false); trigger.current?.focus(); }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const sibling = event.key === "ArrowDown" ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
                    (sibling as HTMLButtonElement | null)?.focus();
                  }
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-zinc-50 disabled:opacity-50">
                <Avatar {...person} className="h-8 w-8 text-xs" />
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-800">{person.name}</span>
                {person.id === value && <Check size={17} className="shrink-0 text-brand-700" aria-hidden="true" />}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-2 py-5 text-center text-sm text-zinc-500">Không tìm thấy đồng nghiệp phù hợp.</p>}
          </div>
          <p className="mt-2 px-2 text-xs text-zinc-500" role="status">{filtered.length} người phù hợp</p>
        </div>
      )}
    </div>
  );
}
