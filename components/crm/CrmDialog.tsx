"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
const subscribe = () => () => {};

export default function CrmDialog({ open, title, pending = false, onClose, children }: {
  open: boolean; title: string; pending?: boolean; onClose: () => void; children: ReactNode;
}) {
  const titleId = useId();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus());
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = overflow; if (active instanceof HTMLElement && active.isConnected) active.focus(); };
  }, [open]);
  if (!open || !mounted) return null;
  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-full w-full max-w-lg overflow-y-auto rounded-[10px] border border-zinc-200 bg-white p-5 shadow-xl" onKeyDown={(event) => {
      if (event.key === "Escape" && !pending) { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href]')].filter((element) => element.getClientRects().length);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }}>
      <header className="mb-5 flex items-center justify-between gap-4"><h2 id={titleId} className="text-base font-semibold">{title}</h2><button type="button" disabled={pending} aria-label="Đóng" onClick={onClose} className="tf-icon-button"><X size={18} aria-hidden="true" /></button></header>
      {children}
    </div>
  </div>, document.body);
}
