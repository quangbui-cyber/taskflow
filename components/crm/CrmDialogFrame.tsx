"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type CrmDialogFrameProps = {
  open: boolean; title: string; children: ReactNode; dirty: boolean; pending: boolean;
  onClose: () => void; onSubmit: () => void; submitLabel: string; footer?: ReactNode;
};
const focusable = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]';
export function focusCrmError(root: HTMLElement | null, errors: Record<string, string>, order: readonly string[]) {
  const first = order.find(field => errors[field]) ?? Object.keys(errors)[0];
  const node = root?.querySelector<HTMLElement>(`[data-crm-field="${first}"]`);
  const input = node?.matches(focusable) ? node : node?.querySelector<HTMLElement>(focusable);
  input?.focus();
}
export default function CrmDialogFrame({ open, title, children, dirty, pending, onClose, onSubmit, submitLabel, footer }: CrmDialogFrameProps) {
  const titleId = useId();
  const section = useRef<HTMLElement>(null);
  const [discard, setDiscard] = useState(false);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => section.current?.querySelector<HTMLElement>(focusable)?.focus());
    function keepFocus(event: FocusEvent) {
      const target = event.target as HTMLElement;
      if (!section.current?.contains(target) && !target.closest("[data-floating-layer]")) section.current?.focus();
    }
    document.addEventListener("focusin", keepFocus);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("focusin", keepFocus); document.body.style.overflow = oldOverflow; if (trigger?.isConnected) trigger.focus(); };
  }, [open]);
  function requestClose() {
    if (pending) return;
    if (dirty) { setDiscard(true); requestAnimationFrame(() => section.current?.querySelector<HTMLElement>("[data-continue]")?.focus()); }
    else onClose();
  }
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="tf-overlay-enter fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 p-3 backdrop-blur-[2px] sm:p-8" onClick={event => { if (event.target === event.currentTarget) requestClose(); }} onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      const floating = [...document.querySelectorAll<HTMLElement>("[data-floating-layer]")].filter(node => !section.current?.contains(node) && node.getClientRects().length);
      if (event.key === "Escape" && !floating.length) { event.preventDefault(); requestClose(); }
      if (event.key === "Enter" && event.ctrlKey && !discard && !floating.length) { event.preventDefault(); if (!pending) onSubmit(); }
      if (event.key === "Tab" && !floating.length) {
        const nodes = [...(section.current?.querySelectorAll<HTMLElement>(focusable) ?? [])].filter(node => node.getClientRects().length && !node.matches(":disabled"));
        const first = nodes[0]; const last = nodes.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === section.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <section ref={section} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="tf-modal-enter max-h-[92vh] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-[14px] border border-zinc-200 bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3"><h2 id={titleId} className="text-base font-semibold text-zinc-900">{title}</h2><button type="button" className="tf-icon-button" aria-label="Đóng" disabled={pending} onClick={requestClose}><X size={17} aria-hidden="true" /></button></div>
        <form noValidate onSubmit={event => { event.preventDefault(); if (!pending && !discard) onSubmit(); }}>
          <fieldset disabled={pending} className="min-w-0 space-y-4">{children}</fieldset>
          {discard ? <div role="group" aria-label="Bỏ nội dung đang ghi?" className="mt-5 space-y-3 rounded-[10px] bg-zinc-50 p-4"><p className="text-sm font-semibold">Bỏ nội dung đang ghi?</p><div className="flex justify-end gap-2"><button type="button" className="tf-button-secondary" onClick={onClose}>Bỏ</button><button data-continue type="button" className="tf-button-primary" onClick={() => setDiscard(false)}>Tiếp tục ghi</button></div></div> : footer ?? <div className="mt-6 flex justify-end gap-2"><button type="button" className="tf-button-secondary" disabled={pending} onClick={requestClose}>Hủy</button><button type="submit" className="tf-button-primary" disabled={pending} aria-busy={pending}>{pending && <span className="tf-spinner" aria-hidden="true" />}{submitLabel}</button></div>}
        </form>
      </section>
    </div>, document.body,
  );
}
