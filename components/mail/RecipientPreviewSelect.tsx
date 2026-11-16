"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { isSalutation, SALUTATION_LABELS } from "@/lib/customerMail";
import { SALUTATION_STYLES } from "./salutationStyles";

type Recipient = { id: string; fullName: string; salutation: string | null };
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

function Badge({ row }: { row?: Recipient }) {
  const salutation = row ? (isSalutation(row.salutation) ? row.salutation : "ban") : "chi";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SALUTATION_STYLES[salutation]}`}>{SALUTATION_LABELS[salutation]}</span>;
}

export default function RecipientPreviewSelect({ recipients, value, onChange }: {
  recipients: Recipient[]; value: string; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const selected = recipients.find((row) => row.id === value);
  const visible = recipients.filter((row) => normalize(`${row.fullName} ${SALUTATION_LABELS[isSalutation(row.salutation) ? row.salutation : "ban"]}`).includes(normalize(query.trim())));
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={root} className="relative" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && !(event.target === search.current && ["Home", "End"].includes(event.key))) {
      event.preventDefault();
      const choices = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-recipient]") ?? []);
      const index = choices.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : event.key === "ArrowDown" ? (index + 1) % choices.length : (index - 1 + choices.length) % choices.length;
      choices[next]?.focus();
    }
  }}>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls={panelId} aria-label="Xem thư của"
      disabled={!recipients.length} onClick={() => { setOpen(!open); setQuery(""); }}
      className="flex min-h-12 w-full items-center gap-2 rounded-[12px] border border-zinc-200 bg-white px-4 py-2.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-brand-400 disabled:cursor-default">
      <span className="min-w-0 truncate">{selected?.fullName ?? "Người nhận mẫu: Nhung"}</span><Badge row={selected} />
      <ChevronDown size={16} className={`ml-auto shrink-0 text-zinc-500 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open && <div id={panelId} className="absolute inset-x-0 top-full z-40 mt-1 rounded-[14px] border border-zinc-200 bg-white p-2 shadow-lg">
      <div className="relative mb-1"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-zinc-400" aria-hidden="true" />
        <input ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Tìm người nhận" placeholder="Tìm người nhận…" className="tf-field !pl-9" />
      </div>
      <div role="group" aria-label="Người nhận xem trước" className="max-h-64 overflow-y-auto">
        {visible.map((row) => <button key={row.id} data-recipient type="button" aria-pressed={row.id === value}
          onClick={() => { onChange(row.id); setOpen(false); trigger.current?.focus(); }}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-zinc-50 focus-visible:bg-brand-50 focus-visible:outline-none ${row.id === value ? "bg-brand-50" : ""}`}>
          <span className="min-w-0 truncate">{row.fullName}</span><Badge row={row} />
          {row.id === value && <Check size={16} className="ml-auto shrink-0 text-brand-700" aria-hidden="true" />}
        </button>)}
        {visible.length === 0 && <p role="status" className="px-3 py-4 text-sm text-zinc-500">Không tìm thấy người nhận.</p>}
      </div>
    </div>}
  </div>;
}
