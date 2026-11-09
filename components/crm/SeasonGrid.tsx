"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { SEASON_CHIP_CLASSES, type buildSeasonGrid, type SeasonChip } from "@/lib/crm/seasonGrid";
import ExpectedEventDialog, { type ExpectedEventDialogOptions } from "./ExpectedEventDialog";

export default function SeasonGrid({ months, canEdit, addEventSlot, eventDialogOptions }: {
  months: ReturnType<typeof buildSeasonGrid>; canEdit: boolean; addEventSlot: ReactNode; eventDialogOptions: ExpectedEventDialogOptions;
}) {
  const [selected, setSelected] = useState<SeasonChip | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const uid = useId();
  const hasChips = months.some(m => m.chips.length);
  // Read the refreshed chip by key; no stale revision remains after a save.
  const chip = selected ? months.flatMap(m => m.chips).find(c => c.key === selected.key) ?? selected : null;
  function close() { setSelected(null); requestAnimationFrame(() => trigger.current?.focus()); }
  useEffect(() => {
    if (!selected) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
      const width = Math.min(340, window.innerWidth - 24);
      const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 380));
      setPosition({ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width, maxHeight: window.innerHeight - top - 12 });
    }
    place();
    const raf = requestAnimationFrame(() => popup.current?.focus());
    function outside(e: PointerEvent) {
      const target = e.target as Element;
      if (!popup.current?.contains(target) && !trigger.current?.contains(target) && !target.closest('[role="dialog"],[data-floating-layer]')) close();
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector('[aria-modal="true"]')) { e.preventDefault(); close(); }
    }
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [selected]);
  return <section className="tf-panel min-w-0" aria-label="Mùa vụ">
    <header className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><h2 className="text-base font-semibold">Mùa vụ</h2>{canEdit && addEventSlot}</header>
    <div className="px-5 pb-5">
      <div className="grid grid-cols-6 gap-1 xl:grid-cols-12">{months.map(month => <div key={month.month} data-season-month={month.month} className={`min-h-16 min-w-0 rounded-[7px] p-1 ${month.chips.length ? "bg-zinc-50" : "bg-zinc-100"}`}>
        <p className="mb-1 text-xs text-zinc-500">T{month.month}</p>
        <div className="space-y-1">{month.chips.map(item => <button key={item.key} type="button" className={`tf-badge block w-full truncate text-left ${item.className}`} aria-label={`${item.label} · ${item.timingLabel} · ${item.sourceLabel}`} title={`${item.label} · ${item.sourceLabel}`} aria-expanded={chip?.key === item.key} aria-controls={chip?.key === item.key ? uid : undefined} aria-haspopup="dialog" onClick={e => { trigger.current = e.currentTarget; setSelected(item); }}>{item.label}</button>)}</div>
      </div>)}</div>
      <div className="mt-3 flex gap-3 overflow-x-auto whitespace-nowrap pb-1 text-xs text-zinc-500" aria-label="Nguồn sự kiện">{([ ["DONE", "Đã làm với CS"], ["CLIENT_CONFIRMED", "Khách xác nhận"], ["HISTORY", "Suy từ lịch sử"], ["INDUSTRY_SEASON", "Mùa vụ ngành"] ] as const).map(([key, label]) => <span key={key} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${SEASON_CHIP_CLASSES[key]}`} />{label}</span>)}</div>
      {!hasChips && <div className="tf-empty mt-4 space-y-3"><p>Chưa có chương trình hay sự kiện dự kiến.</p>{canEdit && addEventSlot}</div>}
    </div>
    {chip && position && typeof document !== "undefined" && createPortal(<div ref={popup} id={uid} role="dialog" aria-label={chip.programLabel} tabIndex={-1} data-floating-layer className="tf-scheduling-popover fixed z-40 overflow-y-auto overscroll-contain p-4 text-sm outline-none" style={position}>
      <div className="mb-3 flex items-start justify-between gap-2"><p className="font-semibold">{chip.programLabel}</p><button type="button" className="tf-icon-button" aria-label="Đóng mùa vụ" onClick={close}><X size={16} aria-hidden="true" /></button></div>
      <dl className="space-y-3">
        <div><dt className="text-xs text-zinc-500">Chương trình</dt><dd className="mt-1 break-words">{chip.programLabel}</dd></div>
        <div><dt className="text-xs text-zinc-500">Đơn vị mua</dt><dd className="mt-1 break-words">{chip.buyingUnitName ?? "—"}</dd></div>
        <div><dt className="text-xs text-zinc-500">Thời gian</dt><dd className="mt-1">{chip.timingLabel}</dd></div>
        <div><dt className="text-xs text-zinc-500">Nguồn</dt><dd className="mt-1">{chip.sourceLabel}</dd></div>
      </dl>
      {chip.kind === "DONE" ? <Link className="mt-4 block break-words text-brand-700 hover:underline" href={`/projects/${chip.projectId}`}>{chip.projectName}</Link> : <>
        <div className="mt-4"><p className="tf-label">Mốc nhắc</p>{chip.steps.length ? <ul className="mt-2 space-y-2">{chip.steps.map((step, index) => <li key={index} className="break-words text-xs text-zinc-600">{step.label} · {step.dueLabel} · {step.statusLabel}</li>)}</ul> : <p className="mt-2 text-xs text-zinc-500">Không có mốc nhắc</p>}</div>
        {chip.edit?.note && <p className="mt-4 whitespace-pre-wrap break-words">{chip.edit.note}</p>}
        {canEdit && chip.edit?.status === "ACTIVE" && <div className="mt-4"><ExpectedEventDialog {...eventDialogOptions} mode={{ kind: "edit", event: chip.edit }} trigger="secondary" /></div>}
      </>}
    </div>, document.body)}
  </section>;
}
