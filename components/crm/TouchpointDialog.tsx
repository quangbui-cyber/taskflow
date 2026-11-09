"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { logTouchpointAction } from "@/app/actions/crmTouchpoints";
import DeadlineField from "@/components/DeadlineField";
import UserPicker from "@/components/UserPicker";
import { useInteraction } from "@/components/InteractionProvider";
import type { TouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import { vnDateKey } from "@/lib/crm/dates";
import { OUTCOME_LEVELS, TOUCHPOINT_KINDS } from "@/lib/crm/labels";
import { buildTouchpointPayload, emptyTouchpointForm, TOUCHPOINT_FIELD_ORDER, validateTouchpointForm, type TouchpointForm, type TouchpointPrefill } from "@/lib/crm/touchpointForm";
import CrmDialogFrame, { focusCrmError } from "./CrmDialogFrame";

export type TouchpointSaved = { success: string; touchpointId: string; openedOpportunityId: string | null };
export type TouchpointDialogProps = {
  options: TouchpointDialogOptions;
  triggerLabel?: string;
  triggerVariant: "primary" | "secondary" | "ghost";
  prefill?: TouchpointPrefill;
  lockClient?: boolean;
  renderTrigger?: false;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved?: (result: TouchpointSaved) => void;
};
function initialize(options: TouchpointDialogOptions, prefill: TouchpointPrefill) {
  const s = emptyTouchpointForm(prefill, vnDateKey(new Date()));
  const client = options.clients.find(c => c.id === s.clientId);
  if (client && !client.canLogClient && !client.openOpportunities.some(o => o.id === s.opportunityId && o.canLog) && !s.completeTaskId) {
    const own = client.assignedTasks.find(task => task.opportunityId === s.opportunityId) ?? client.assignedTasks[0];
    if (own) { s.opportunityId = own.opportunityId; s.completeTaskId = own.id; }
  }
  if (!options.users.some(user => user.id === s.assigneeId)) s.assigneeId = options.users.find(user => user.id === client?.picUserId)?.id ?? null;
  return s;
}
export default function TouchpointDialog(props: TouchpointDialogProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = props.open ?? localOpen;
  const setOpen = (value: boolean) => { if (props.open === undefined) setLocalOpen(value); props.onOpenChange?.(value); };
  return <>
    {props.renderTrigger !== false && <button type="button" className={`tf-button-${props.triggerVariant}`} disabled={!props.options.clients.length} onClick={() => setOpen(true)}>{props.triggerLabel ?? "Ghi điểm chạm"}</button>}
    {open && <TouchpointDialogBody {...props} onClose={() => setOpen(false)} />}
  </>;
}
function TouchpointDialogBody({ options, prefill = {}, lockClient, onSaved, onClose }: TouchpointDialogProps & { onClose: () => void }) {
  const [state, setState] = useState(() => initialize(options, prefill));
  const [initial] = useState(() => JSON.stringify(state));
  const [requestId] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const uid = useId();
  const { notify } = useInteraction();
  const router = useRouter();
  const client = options.clients.find(c => c.id === state.clientId);
  const opening = state.outcomeLevel === 4 && !state.opportunityId && state.openOpportunity;
  const dirty = initial !== JSON.stringify(state);
  function set<K extends keyof TouchpointForm>(key: K, value: TouchpointForm[K]) {
    setState(s => ({ ...s, [key]: value }));
    setErrors(e => { const next = { ...e }; delete next[key]; return next; });
  }
  function chooseClient(clientId: string) {
    const next = options.clients.find(c => c.id === clientId);
    const own = !next?.canLogClient ? next?.assignedTasks[0] : undefined;
    setState(s => ({ ...s, clientId, opportunityId: own?.opportunityId ?? (!next?.canLogClient ? next?.openOpportunities.find(o => o.canLog)?.id : null) ?? null, completeTaskId: own?.id ?? null, confirmDraftId: null, assigneeId: options.users.find(u => u.id === next?.picUserId)?.id ?? null }));
    setErrors({});
  }
  function chooseOpportunity(opportunityId: string | null) {
    const own = client?.assignedTasks.find(task => task.opportunityId === opportunityId);
    const canLog = opportunityId ? client?.openOpportunities.some(o => o.id === opportunityId && o.canLog) : client?.canLogClient;
    setState(s => ({ ...s, opportunityId, completeTaskId: canLog ? (prefill.opportunityId === opportunityId ? prefill.completeTaskId ?? null : null) : own?.id ?? null, openOpportunity: false }));
  }
  function a(field: string) {
    return { id: `${uid}-${field}`, "aria-invalid": !!errors[field] || undefined, "aria-describedby": errors[field] ? `${uid}-${field}-error` : undefined, style: errors[field] ? { borderColor: "var(--danger)" } : undefined };
  }
  function field(name: string, label: string, children: ReactNode) {
    return <div data-crm-field={name}>
      <label htmlFor={`${uid}-${name}`} className="tf-label mb-1.5 block">{label}</label>
      {children}
      {errors[name] && <p id={`${uid}-${name}-error`} className="mt-1 text-xs text-[var(--danger)]" role="alert">{errors[name]}</p>}
    </div>;
  }
  function showErrors(next: Record<string, string>) {
    setErrors(next);
    requestAnimationFrame(() => focusCrmError(root.current, next, TOUCHPOINT_FIELD_ORDER));
  }
  function submit() {
    if (submitting.current || pending) return;
    const next = validateTouchpointForm(state);
    if (!client) next.clientId = "Chọn khách hàng.";
    const canLog = state.opportunityId ? client?.openOpportunities.some(o => o.id === state.opportunityId && o.canLog) : client?.canLogClient;
    if (client && !canLog && !state.completeTaskId) next.opportunityId = "Chọn Cơ hội có việc được giao.";
    if (Object.keys(next).length) { showErrors(next); return; }
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await logTouchpointAction(buildTouchpointPayload(state, requestId));
        if ("error" in result && result.error) {
          if (result.fieldErrors) {
            const mapped = { ...result.fieldErrors };
            if (mapped.next) { mapped[state.mode === "WAIT" ? "waitReason" : "nextTitle"] = mapped.next; delete mapped.next; }
            if (mapped.openOpportunity) { mapped.demandSignal = mapped.openOpportunity; delete mapped.openOpportunity; }
            showErrors(mapped);
          }
          notify({ tone: "error", message: result.error }); return;
        }
        if ("success" in result && result.success) {
          notify({ tone: "success", message: result.success });
          onClose(); onSaved?.(result); router.refresh();
        }
      } catch { notify({ tone: "error", message: "Không lưu được. Kiểm tra kết nối rồi thử lại." }); }
      finally { submitting.current = false; }
    });
  }
  function dateField(name: "occurredAt" | "nextDueDate" | "waitReviewDate", label: string) {
    return <div data-crm-field={name}>
      <DeadlineField dateOnly required id={`${uid}-${name}`} label={label} value={state[name]} onChange={value => set(name, value)} invalid={!!errors[name]} describedBy={errors[name] ? `${uid}-${name}-error` : undefined} />
      {errors[name] && <p id={`${uid}-${name}-error`} role="alert" className="mt-1 text-xs text-[var(--danger)]">{errors[name]}</p>}
    </div>;
  }
  return <CrmDialogFrame
    open
    title={client ? `Ghi điểm chạm · ${client.name}` : "Ghi điểm chạm"}
    dirty={dirty}
    pending={pending}
    onClose={onClose}
    onSubmit={submit}
    submitLabel="Lưu điểm chạm"
  >
    <div ref={root} className="space-y-4">
      {field("clientId", "Khách hàng", <select
        {...a("clientId")}
        value={state.clientId}
        onChange={e => chooseClient(e.target.value)}
        disabled={lockClient}
        className="tf-field"
      >
        <option value="">Chọn khách hàng</option>
        {options.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>)}
      {field("opportunityId", "Cơ hội", <select
        {...a("opportunityId")}
        value={state.opportunityId ?? ""}
        disabled={!!state.confirmDraftId || !!prefill.completeTaskId}
        onChange={e => chooseOpportunity(e.target.value || null)}
        className="tf-field"
      >
        <option value="" disabled={client && !client.canLogClient && !client.assignedTasks.some(t => !t.opportunityId)}>Không gắn Cơ hội</option>
        {client?.openOpportunities.map(o => <option key={o.id} value={o.id} disabled={!o.canLog && !client.assignedTasks.some(t => t.opportunityId === o.id)}>{o.name}</option>)}
      </select>)}
      <div data-crm-field="kind">
        <span id={`${uid}-kind-label`} className="tf-label">Loại</span>
        <div role="radiogroup" aria-labelledby={`${uid}-kind-label`} className="mt-2 flex flex-wrap gap-2">
          {TOUCHPOINT_KINDS.map(k => <label key={k.key} className={`cursor-pointer rounded-[10px] border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-zinc-400 ${state.kind === k.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-700"}`}>
            <input type="radio" className="sr-only" name={`${uid}-kind`} checked={state.kind === k.key} onChange={() => set("kind", k.key)} />{k.label}
          </label>)}
        </div>
      </div>
      {dateField("occurredAt", "Ngày")}
      <div data-crm-field="outcomeLevel">
        <span id={`${uid}-outcome-label`} className="tf-label">Kết quả</span>
        <div role="radiogroup" aria-labelledby={`${uid}-outcome-label`} aria-invalid={!!errors.outcomeLevel || undefined} aria-describedby={errors.outcomeLevel ? `${uid}-outcomeLevel-error` : undefined} className="mt-2 grid gap-2 sm:grid-cols-2">
          {OUTCOME_LEVELS.map(level => <label key={level.key} className={`flex cursor-pointer items-center gap-2 rounded-[10px] border p-3 text-sm focus-within:ring-2 focus-within:ring-zinc-400 ${state.outcomeLevel === level.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-700"}`}>
            <input type="radio" className="sr-only" name={`${uid}-outcome`} checked={state.outcomeLevel === level.key} onChange={() => set("outcomeLevel", level.key)} />
            <span aria-hidden="true" className="text-[10px] tracking-tight">{"●".repeat(level.key)}</span>{level.label}
          </label>)}
        </div>
        {errors.outcomeLevel && <p id={`${uid}-outcomeLevel-error`} role="alert" className="mt-1 text-xs text-[var(--danger)]">{errors.outcomeLevel}</p>}
      </div>
      {state.outcomeLevel === 4 && !state.opportunityId && client?.canLogClient && <button type="button" role="switch" aria-checked={state.openOpportunity} onClick={() => set("openOpportunity", !state.openOpportunity)} className="flex min-h-10 w-full items-center justify-between gap-3 text-left text-sm">
        Mở Cơ hội ở Chăm sóc<span aria-hidden="true" className={`flex h-6 w-10 items-center rounded-full p-1 ${state.openOpportunity ? "justify-end bg-zinc-900" : "bg-zinc-200"}`}><span className="h-4 w-4 rounded-full bg-white" /></span>
      </button>}
      {opening && <div className="space-y-4">
        {field("programTypeCode", "Loại chương trình", <select {...a("programTypeCode")} className="tf-field" value={state.programTypeCode} onChange={e => set("programTypeCode", e.target.value)}>
          <option value="">Chọn loại chương trình</option>{options.programTypes.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
        </select>)}
        {field("expectedPeriod", "Tháng hoặc quý dự kiến", <div className="grid grid-cols-3 gap-2">
          <select aria-label="Tháng hoặc quý" className="tf-field" value={state.periodMode} onChange={e => { set("periodMode", e.target.value); set("expectedPeriod", ""); }}><option value="MONTH">Tháng</option><option value="QUARTER">Quý</option></select>
          <select {...a("expectedPeriod")} aria-label={state.periodMode === "MONTH" ? "Tháng dự kiến" : "Quý dự kiến"} className="tf-field" value={state.expectedPeriod} onChange={e => set("expectedPeriod", e.target.value)}><option value="">Chọn</option>{Array.from({ length: state.periodMode === "QUARTER" ? 4 : 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select>
          <input aria-label="Năm dự kiến" inputMode="numeric" className="tf-field" value={state.expectedYear} onChange={e => set("expectedYear", e.target.value)} />
        </div>)}
        {field("demandSignal", "Tín hiệu nhu cầu", <textarea {...a("demandSignal")} rows={2} maxLength={2000} className="tf-field" value={state.demandSignal} onChange={e => set("demandSignal", e.target.value)} />)}
      </div>}
      {field("notes", "Điều mới biết", <textarea {...a("notes")} rows={3} maxLength={2000} className="tf-field" value={state.notes} onChange={e => set("notes", e.target.value)} />)}
      <div role="radiogroup" aria-label="Bước tiếp theo" className="flex gap-1 rounded-[10px] bg-zinc-100 p-1">
        {([ ["NEXT_STEP", "Có bước tiếp theo"], ["WAIT", "Chờ khách"] ] as const).map(([value, label]) => <label key={value} className={`flex-1 cursor-pointer rounded-[8px] px-3 py-2 text-center text-sm focus-within:ring-2 focus-within:ring-zinc-400 ${state.mode === value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"}`}><input type="radio" className="sr-only" name={`${uid}-next`} checked={state.mode === value} onChange={() => set("mode", value)} />{label}</label>)}
      </div>
      {state.mode === "NEXT_STEP" ? <>
        {field("nextTitle", "Việc cần làm", <input {...a("nextTitle")} maxLength={200} className="tf-field" value={state.nextTitle} onChange={e => set("nextTitle", e.target.value)} />)}
        {field("assigneeId", "Người làm", <div role="group" {...a("assigneeId")}>
          <UserPicker
            options={options.users}
            value={state.assigneeId ?? ""}
            onChange={value => set("assigneeId", value || null)}
            ariaLabel="Người làm"
            placeholder="Chọn người làm"
          />
        </div>)}
        {dateField("nextDueDate", "Hạn")}
      </> : <>
        {field("waitReason", "Lý do chờ", <textarea {...a("waitReason")} maxLength={500} rows={2} className="tf-field" value={state.waitReason} onChange={e => set("waitReason", e.target.value)} />)}
        {dateField("waitReviewDate", "Xem lại ngày")}
      </>}
    </div>
  </CrmDialogFrame>;
}
