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
import { vnDateKey } from "@/lib/crm/dates";
import type { TierValue } from "@/lib/crm/settingsSchema";
import { REVIEW_DONE_LABELS, reviewPrimaryLabel, reviewRowSentence, type ReviewRowActions } from "@/lib/crm/reviewView";
import { ownerHref } from "@/lib/workOwner";
import { TierSquare } from "./TierBadge";
import TouchpointDialog from "./TouchpointDialog";

type Panel = "MENU" | "ASSIGN" | "POSTPONE" | "ASSIGN_PIC";
type Props = {
  row: Row; actions: ReviewRowActions; dialogOptions: TouchpointDialogOptions;
  accounts: { id: string; name: string }[]; now: Date; cadenceWeeks: Record<TierValue, number>; showPic: boolean;
  /** crm51: "first" = Cần làm trước, "week" = Trong tuần (actions on hover/focus), "compact" = right column. */
  variant?: "first" | "week" | "compact";
};
const FALLBACK = "Không lưu được. Kiểm tra kết nối rồi thử lại.";
export default function ReviewRow({ row, actions, dialogOptions, accounts, now, cadenceWeeks, showPic, variant = "first" }: Props) {
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
  const [escalated, setEscalated] = useState(false);
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
  function run(action: () => Promise<{ error?: string; success?: string }>, mark?: keyof typeof REVIEW_DONE_LABELS, onSuccess?: () => void) {
    if (submitting.current || pending) return;
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error || !result.success) { notify({ tone: "error", message: result.error || FALLBACK }); return; }
        notify({ tone: "success", message: result.success });
        if (mark) setDone(mark);
        onSuccess?.();
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
  const primaryLabel = variant === "compact" && actions.primary === "SET_NEXT_STEP" ? "Đặt việc" : reviewPrimaryLabel(actions.primary);
  const sentence = reviewRowSentence(row, now, cadenceWeeks);
  const toneClass = sentence.lateTone === "late" ? "bg-[#fff4ed] text-[#c2410c]" : sentence.lateTone === "warn" ? "bg-[#fff7e6] text-[#b86a08]" : "text-zinc-500";
  const context = [sentence.why, sentence.lastTouch, row.opportunity && `Cơ hội: ${row.opportunity.name}`].filter(Boolean).join(" · ");
  const urgency = row.group === "OVERDUE" ? "bg-[#c2410c]" : sentence.lateTone === "warn" ? "bg-[#f59e0b]" : "bg-zinc-200";
  // crm51: one primary button per row; assign, postpone, edit and escalate live in the ⋯ menu.
  const menuItems = [
    ...actions.secondary.map(a => ({ key: a, label: a === "ASSIGN" ? "Giao lại" : "Hoãn" })),
    ...(row.taskId && actions.secondary.includes("POSTPONE") ? [{ key: "EDIT" as const, label: "Đổi việc" }] : []),
    ...(!escalated ? actions.menu.map(a => ({ key: a, label: "Nhờ AD/AM hỗ trợ" })) : []),
  ];
  // Week lane: actions appear on hover or focus where a pointer can hover; touch screens always show them.
  const reveal = variant === "week" ? "transition-opacity duration-150 motion-reduce:transition-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100" : "";
  const compact = variant === "compact";
  return <article data-review-key={row.key} data-review-lane={variant} aria-label={row.client.name} className={`group relative grid min-w-0 gap-2 text-sm ${compact ? "py-2" : "py-3 pl-5 pr-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-4"} ${done ? "opacity-50 transition-opacity duration-[160ms] motion-reduce:transition-none" : ""}`}>
    {!compact && <span aria-hidden="true" className={`absolute bottom-3 left-2 top-3 w-[3px] rounded-full ${urgency}`} />}
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><TierSquare tier={row.client.tier} /><Link href={`/crm/clients/${row.client.id}`} className="min-w-0 break-words font-semibold text-zinc-900 hover:underline">{row.client.name}</Link>{!compact && sentence.lateLabel && <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>{sentence.lateLabel}</span>}</div>
      {!compact && <p data-review-todo className="mt-1 truncate text-[13px] text-zinc-700" title={[sentence.todo, context].filter(Boolean).join(" · ")}><span className={sentence.todoMuted ? "text-zinc-500" : "font-medium text-zinc-900"}>{sentence.todo}</span>{context && <span className="text-zinc-500"> · {context}</span>}</p>}
      {compact && sentence.lateLabel && <p className="mt-0.5 truncate text-xs text-zinc-500" title={sentence.why ?? undefined}>{sentence.lateLabel}</p>}
    </div>
    <div className={`flex min-w-0 flex-wrap items-center gap-2 md:flex-nowrap md:justify-end ${reveal}`}>{done ? <span role="status" className="py-2 text-xs text-zinc-500">{REVIEW_DONE_LABELS[done]}</span> : <>
      {showPic && !compact && (row.pic ? <span title={row.pic.name} className="hidden md:inline-flex"><Avatar id={row.pic.accountId} name={row.pic.name} className="h-6 w-6 text-xs" /></span> : <span className="hidden whitespace-nowrap text-xs text-zinc-400 md:inline">Chưa giao</span>)}
      {actions.primary && <button type="button" className={`tf-button-secondary min-h-10 whitespace-nowrap md:!min-h-9 ${compact ? "" : "flex-1 md:flex-none"}`} disabled={pending} onClick={e => { if (actions.primary === "ASSIGN_PIC") openPanel("ASSIGN_PIC", e.currentTarget); else setDialog(true); }}>{primaryLabel}</button>}
      {!!menuItems.length && <button type="button" aria-label={`Thao tác khác cho ${row.client.name}`} aria-haspopup="dialog" aria-expanded={panel !== null && panel !== "ASSIGN_PIC"} aria-controls={panel ? `${uid}-panel` : undefined} className="tf-icon-button min-h-10 md:!h-9 md:!min-h-9 md:!w-9" disabled={pending} onClick={e => openPanel("MENU", e.currentTarget)}><MoreHorizontal size={16} aria-hidden="true" /></button>}
      {escalated && <span role="status" className="whitespace-nowrap text-xs text-zinc-500">Đã nhờ AD/AM</span>}
    </>}</div>
    <TouchpointDialog options={dialogOptions} triggerVariant="secondary" renderTrigger={false} open={dialog} onOpenChange={setDialog} lockClient prefill={row.prefill} onSaved={() => setDone("LOGGED")} />
    {panel && position && createPortal(<div ref={popup} id={`${uid}-panel`} role="dialog" aria-label={panel === "MENU" ? "Thao tác khác" : panel === "POSTPONE" ? "Hoãn có lý do" : panel === "ASSIGN_PIC" ? "Giao PIC" : "Giao lại người và hạn"} data-floating-layer className="tf-scheduling-popover fixed z-40 max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[8px] border border-zinc-200 bg-white p-4" style={position}>
      <div className="mb-3 flex justify-end"><button type="button" className="tf-icon-button !h-9 !min-h-9 !w-9" disabled={pending} aria-label="Đóng" onClick={closePanel}><X size={14} aria-hidden="true" /></button></div>
      {panel === "MENU" ? <div className="space-y-1">{menuItems.map(item => item.key === "EDIT" ? <Link key={item.key} href={ownerHref({ kind: row.opportunity ? "OPPORTUNITY" : "CLIENT", id: row.opportunity?.id ?? row.client.id }, row.taskId!)} className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-zinc-50">{item.label}</Link> : <button key={item.key} type="button" disabled={pending} aria-busy={pending && item.key === "ESCALATE"} className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-zinc-50" onClick={e => item.key === "ESCALATE" ? run(() => escalateCrmTaskAction(row.taskId), undefined, () => setEscalated(true)) : openPanel(item.key, trigger.current ?? e.currentTarget)}>{pending && item.key === "ESCALATE" && <span className="tf-spinner" />}{item.label}</button>)}</div> : <form className="space-y-4" aria-busy={pending} onSubmit={e => { e.preventDefault(); submit(); }}>
        {panel === "ASSIGN" && <><UserPicker options={dialogOptions.users} value={assignee} onChange={setAssignee} ariaLabel="Người làm" disabled={pending} /><DeadlineField dateOnly required label="Hạn" value={due} onChange={setDue} /></>}
        {panel === "ASSIGN_PIC" && <div><label htmlFor={`${uid}-pic`} className="tf-label">PIC</label><select id={`${uid}-pic`} required disabled={pending} className="tf-field" value={pic} onChange={e => setPic(e.target.value)}><option value="">Chọn PIC</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
        {panel === "POSTPONE" && <><div><label htmlFor={`${uid}-reason`} className="tf-label">Lý do hoãn</label><textarea id={`${uid}-reason`} className="tf-field" rows={2} maxLength={500} value={reason} disabled={pending} onChange={e => setReason(e.target.value)} aria-required="true" aria-invalid={invalid && !reason.trim() || undefined} aria-describedby={invalid ? `${uid}-error` : undefined} /></div><DeadlineField dateOnly required label="Xem lại ngày" value={reviewDate} onChange={setReviewDate} invalid={invalid && !reviewDate} describedBy={invalid ? `${uid}-error` : undefined} />{invalid && <p id={`${uid}-error`} role="alert" className="text-xs text-[var(--danger)]">Nhập lý do hoãn và ngày xem lại.</p>}</>}
        <button type="submit" className="tf-button-secondary min-h-10 md:!min-h-9" disabled={pending || panel === "ASSIGN" && (!assignee || !due)} aria-busy={pending}>{pending && <span className="tf-spinner" />}{panel === "POSTPONE" ? "Hoãn" : "Giao"}</button>
      </form>}
    </div>, document.body)}
  </article>;
}
