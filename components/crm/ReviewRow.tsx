"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { assignCrmTaskAction, postponeCrmTaskAction, escalateCrmTaskAction, assignClientPicAction } from "@/app/actions/crmEvents";
import Avatar from "@/components/Avatar";
import UserPicker from "@/components/UserPicker";
import DeadlineField from "@/components/DeadlineField";
import { useInteraction } from "@/components/InteractionProvider";
import type { ReviewRow as Row } from "@/lib/crm/reviewData";
import type { TouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import { formatCrmDate, vnDateKey } from "@/lib/crm/dates";
import { OUTCOME_LEVELS } from "@/lib/crm/labels";
import { lateLabel, REVIEW_DONE_LABELS, type rowActionsFor } from "@/lib/crm/reviewView";
import TierBadge from "./TierBadge";
import OutcomeDots from "./OutcomeDots";
import TouchpointDialog from "./TouchpointDialog";

type Panel = "MENU" | "ASSIGN" | "POSTPONE" | "ASSIGN_PIC";
type Props = {
  row: Row; actions: ReturnType<typeof rowActionsFor>; dialogOptions: TouchpointDialogOptions;
  accounts: { id: string; name: string }[]; now: Date;
};
const FALLBACK = "Không lưu được. Kiểm tra kết nối rồi thử lại.";
export default function ReviewRow({ row, actions, dialogOptions, accounts, now }: Props) {
  const { notify } = useInteraction();
  const [done, setDone] = useState<keyof typeof REVIEW_DONE_LABELS | null>(null);
  const [dialog, setDialog] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const [pending, startTransition] = useTransition();
  const [assignee, setAssignee] = useState(row.assignee?.id ?? row.pic?.userId ?? "");
  const [due, setDue] = useState(row.dueDate ? vnDateKey(row.dueDate) : "");
  const [pic, setPic] = useState("");
  const [reason, setReason] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [invalid, setInvalid] = useState(false);
  const uid = useId();
  function closePanel() { setPanel(null); requestAnimationFrame(() => trigger.current?.focus()); }
  function openPanel(value: Panel, button: HTMLButtonElement) { trigger.current = button; setPanel(value); setInvalid(false); }
  useEffect(() => {
    if (!panel) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 380));
      setPosition({ top, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), width, maxHeight: window.innerHeight - top - 12 });
    }
    place();
    function outside(e: PointerEvent) {
      const target = e.target as Element;
      if (!pending && !popup.current?.contains(target) && !trigger.current?.contains(target) && !target.closest("[data-floating-layer]")) closePanel();
    }
    function escape(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || pending) return;
      if (popup.current?.querySelector('[data-open="true"]')) return;
      if (document.querySelector('[data-floating-layer][role="listbox"]')) return;
      e.preventDefault();
      closePanel();
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [panel, pending]);
  useEffect(() => {
    if (!panel) return;
    const frame = requestAnimationFrame(() => popup.current?.querySelector<HTMLElement>("button,input,select,textarea")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [panel]);
  function run(action: () => Promise<{ error?: string; success?: string }>, mark?: keyof typeof REVIEW_DONE_LABELS) {
    if (submitting.current || pending) return;
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error || !result.success) { notify({ tone: "error", message: result.error || FALLBACK }); return; }
        notify({ tone: "success", message: result.success });
        if (mark) setDone(mark);
        closePanel();
      } catch { notify({ tone: "error", message: FALLBACK }); }
      finally { submitting.current = false; }
    });
  }
  function submit() {
    if (panel === "POSTPONE") {
      if (!reason.trim() || !reviewDate) { setInvalid(true); requestAnimationFrame(() => popup.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
      run(() => postponeCrmTaskAction({ taskId: row.taskId, reason, reviewDate }), "POSTPONED");
    } else if (panel === "ASSIGN") run(() => assignCrmTaskAction({ taskId: row.taskId, assigneeId: assignee, dueDate: due }), "ASSIGNED");
    else if (panel === "ASSIGN_PIC") run(() => assignClientPicAction(row.client.id, pic, row.client.version), "ASSIGNED");
  }
  const primaryLabel = actions.primary === "LOG_RESULT" ? "Ghi kết quả" : actions.primary === "SET_NEXT_STEP" ? "Đặt bước tiếp" : "Giao PIC";
  const late = lateLabel(row.dueDate, now);
  const sourceClass = row.reason.sourceLabel === "Khách xác nhận" ? "bg-emerald-50 text-emerald-700" : row.reason.sourceLabel === "Suy từ lịch sử" ? "border border-dashed border-zinc-400 bg-white text-zinc-600" : "border border-dashed border-zinc-300 bg-white text-zinc-500";
  return <article data-review-key={row.key} aria-label={row.client.name} className={`grid min-w-0 gap-4 px-5 py-4 text-sm md:grid-cols-[1.6fr_2.4fr_1.4fr_1fr_auto] ${done ? "opacity-50 transition-opacity duration-[160ms] motion-reduce:transition-none" : ""}`}>
    <div className="min-w-0"><Link href={`/crm/clients/${row.client.id}`} className="break-words font-semibold hover:underline">{row.client.name}</Link><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">{row.client.buyingUnitName && <span>{row.client.buyingUnitName} ·</span>}<TierBadge tier={row.client.tier} /></div></div>
    <div className="min-w-0"><div className="flex flex-wrap gap-2"><span className="tf-badge bg-zinc-100 text-zinc-700">{row.reason.label}</span>{row.reason.sourceLabel && <span className={`tf-badge ${sourceClass}`}>{row.reason.sourceLabel}</span>}</div><p className="mt-2 break-words">{row.reason.sentence}{late && <span className="ml-2 text-[#b86a08]">{late}</span>}</p></div>
    <div className="min-w-0 space-y-1 text-xs text-zinc-500">{row.lastTouch ? <><p>{formatCrmDate(row.lastTouch.date, now)} · {row.lastTouch.kindLabel}</p><OutcomeDots level={OUTCOME_LEVELS.find(l => l.label === row.lastTouch?.outcomeLabel)?.key ?? null} /></> : <span>—</span>}{row.opportunity ? <Link href={`/crm/opportunities/${row.opportunity.id}`} className="block break-words hover:underline">Cơ hội: {row.opportunity.name}</Link> : <p className="text-zinc-400">Chưa có Cơ hội</p>}</div>
    <div className="min-w-0 text-xs"><div className="flex items-center gap-2">{row.pic ? <Avatar id={row.pic.accountId} name={row.pic.name} className="h-6 w-6 text-xs" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">?</span>}<span className="break-words">{row.pic?.name ?? "Chưa giao"}</span></div>{row.dueDate && <p className="mt-1 text-zinc-500">hạn {formatCrmDate(row.dueDate, now)}</p>}</div>
    <div className="flex items-start gap-2">{done ? <span role="status" className="py-2 text-xs text-zinc-500">{REVIEW_DONE_LABELS[done]}</span> : <>
      {actions.primary && <button type="button" className="tf-button-secondary min-h-10 whitespace-nowrap md:!min-h-9" disabled={pending} onClick={e => { if (actions.primary === "ASSIGN_PIC") openPanel("ASSIGN_PIC", e.currentTarget); else setDialog(true); }}>{primaryLabel}</button>}
      {!!actions.menu.length && <button type="button" aria-label="Thao tác khác" aria-expanded={!!panel} aria-controls={`${uid}-panel`} className="tf-icon-button min-h-10 md:!min-h-9" disabled={pending} onClick={e => openPanel("MENU", e.currentTarget)}><MoreHorizontal size={16} aria-hidden="true" /></button>}
    </>}</div>
    <TouchpointDialog options={dialogOptions} triggerVariant="secondary" renderTrigger={false} open={dialog} onOpenChange={setDialog} lockClient prefill={row.prefill} onSaved={() => setDone("LOGGED")} />
    {panel && position && createPortal(<div ref={popup} id={`${uid}-panel`} role="dialog" aria-label={panel === "MENU" ? "Thao tác khác" : panel === "POSTPONE" ? "Hoãn có lý do" : panel === "ASSIGN_PIC" ? "Giao PIC" : "Giao người và hạn"} data-floating-layer className="tf-scheduling-popover fixed z-40 max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[8px] border border-zinc-200 bg-white p-4" style={position}>
      <div className="mb-3 flex justify-end"><button type="button" className="tf-icon-button !h-9 !min-h-9 !w-9" disabled={pending} aria-label="Đóng" onClick={closePanel}><X size={14} aria-hidden="true" /></button></div>
      {panel === "MENU" ? <div className="space-y-1">{actions.menu.map(a => <button key={a} type="button" disabled={pending} aria-busy={pending} className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-zinc-50" onClick={() => a === "ESCALATE" ? run(() => escalateCrmTaskAction(row.taskId)) : setPanel(a)}>{pending && <span className="tf-spinner" />}{a === "ASSIGN" ? "Giao người và hạn" : a === "POSTPONE" ? "Hoãn có lý do" : "Cần AD/AM"}</button>)}</div> : <form className="space-y-4" aria-busy={pending} onSubmit={e => { e.preventDefault(); submit(); }}>
        {panel === "ASSIGN" && <><UserPicker options={dialogOptions.users} value={assignee} onChange={setAssignee} ariaLabel="Người làm" disabled={pending} /><DeadlineField dateOnly required label="Hạn" value={due} onChange={setDue} /></>}
        {panel === "ASSIGN_PIC" && <div><label htmlFor={`${uid}-pic`} className="tf-label">PIC</label><select id={`${uid}-pic`} required disabled={pending} className="tf-field" value={pic} onChange={e => setPic(e.target.value)}><option value="">Chọn PIC</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
        {panel === "POSTPONE" && <><div><label htmlFor={`${uid}-reason`} className="tf-label">Lý do hoãn</label><textarea id={`${uid}-reason`} className="tf-field" rows={2} maxLength={500} value={reason} disabled={pending} onChange={e => setReason(e.target.value)} aria-required="true" aria-invalid={invalid && !reason.trim() || undefined} aria-describedby={invalid ? `${uid}-error` : undefined} /></div><DeadlineField dateOnly required label="Xem lại ngày" value={reviewDate} onChange={setReviewDate} invalid={invalid && !reviewDate} describedBy={invalid ? `${uid}-error` : undefined} />{invalid && <p id={`${uid}-error`} role="alert" className="text-xs text-[var(--danger)]">Nhập lý do hoãn và ngày xem lại.</p>}</>}
        <button type="submit" className="tf-button-secondary min-h-10 md:!min-h-9" disabled={pending || panel === "ASSIGN" && (!assignee || !due)} aria-busy={pending}>{pending && <span className="tf-spinner" />}{panel === "POSTPONE" ? "Hoãn" : "Giao"}</button>
      </form>}
    </div>, document.body)}
  </article>;
}
