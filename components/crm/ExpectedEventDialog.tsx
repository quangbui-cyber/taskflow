"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createExpectedEventAction, updateExpectedEventAction } from "@/app/actions/crmEvents";
import DeadlineField from "@/components/DeadlineField";
import { useInteraction } from "@/components/InteractionProvider";
import { vnDateKey } from "@/lib/crm/dates";
import { EVENT_SOURCES } from "@/lib/crm/labels";
import { expectedEventToast, previewReminderSteps, validateExpectedEventForm, type ExpectedEventFormState } from "@/lib/crm/expectedEventForm";
import type { SeasonEventInput } from "@/lib/crm/seasonGrid";
import CrmDialogFrame, { focusCrmError } from "./CrmDialogFrame";

export type ExpectedEventDialogOptions = {
  clientId: string; clientName: string; programTypes: { code: string; label: string }[];
  buyingUnits: { id: string; name: string }[]; reminderOffsets: Record<string, number[]>;
};
type Props = ExpectedEventDialogOptions & {
  mode: { kind: "create" } | { kind: "edit"; event: SeasonEventInput };
  trigger: "ghost" | "menuitem" | "empty" | "secondary";
};
const FALLBACK = "Không lưu được. Kiểm tra kết nối rồi thử lại.";
export default function ExpectedEventDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const label = props.mode.kind === "edit" ? "Sửa" : "Thêm sự kiện dự kiến";
  return <>
    <button type="button" role={props.trigger === "menuitem" ? "menuitem" : undefined} className={props.trigger === "menuitem" ? "flex min-h-10 w-full items-center rounded-[8px] px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 focus:bg-zinc-100 focus:outline-none" : `tf-button-${props.trigger === "empty" ? "secondary" : props.trigger}`} onClick={() => setOpen(true)}>{label}</button>
    {open && <ExpectedEventDialogBody {...props} onClose={() => setOpen(false)} />}
  </>;
}
function ExpectedEventDialogBody({ mode, clientId, clientName, programTypes, buyingUnits, reminderOffsets, onClose }: Props & { onClose: () => void }) {
  const [today] = useState(() => new Date());
  const nowYear = Number(vnDateKey(today).slice(0, 4));
  const [state, setState] = useState<ExpectedEventFormState>(() => {
    const event = mode.kind === "edit" ? mode.event : null;
    return { programTypeCode: event?.programTypeCode ?? "", buyingUnitId: event?.buyingUnitId ?? "", precision: event?.precision ?? "DAY", dateKey: event?.date ? vnDateKey(event.date) : "", month: String(event?.month ?? ""), quarter: String(event?.quarter ?? ""), year: String(event?.year ?? nowYear), source: event?.source ?? "", note: event?.note ?? "" };
  });
  const [initial] = useState(() => JSON.stringify(state));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const uid = useId();
  const router = useRouter(); const { notify } = useInteraction();
  const parsed = validateExpectedEventForm({ ...state, source: state.source || "CLIENT_CONFIRMED", note: "" }, nowYear);
  const preview = "ok" in parsed ? previewReminderSteps(parsed.value, reminderOffsets, today) : [];
  function set<K extends keyof ExpectedEventFormState>(key: K, value: ExpectedEventFormState[K]) {
    setState(s => ({ ...s, [key]: value }));
    setErrors(e => { const next = { ...e }; delete next[["precision", "dateKey", "month", "quarter", "year"].includes(key) ? "time" : key]; return next; });
  }
  function attrs(name: string) {
    return { id: `${uid}-${name}`, "aria-invalid": !!errors[name] || undefined, "aria-describedby": errors[name] ? `${uid}-${name}-error` : undefined };
  }
  function field(name: string, label: string, children: ReactNode) {
    return <div data-crm-field={name}><label htmlFor={`${uid}-${name}`} className="tf-label mb-1.5 block">{label}</label>{children}{error(name)}</div>;
  }
  function error(name: string) { return errors[name] && <p id={`${uid}-${name}-error`} role="alert" className="mt-1 text-xs text-[var(--danger)]">{errors[name]}</p>; }
  function submit() {
    if (pending || submitting.current) return;
    const result = validateExpectedEventForm(state, nowYear);
    if ("errors" in result) { setErrors(result.errors as Record<string, string>); requestAnimationFrame(() => focusCrmError(root.current, result.errors as Record<string, string>, ["programTypeCode", "time", "source", "note"])); return; }
    submitting.current = true;
    startTransition(async () => {
      try {
        const payload = { ...result.value, clientId };
        const saved = mode.kind === "create" ? await createExpectedEventAction(payload) : await updateExpectedEventAction({ ...payload, eventId: mode.event.id });
        if ("error" in saved) { notify({ tone: "error", message: saved.error || FALLBACK }); return; }
        const count = "steps" in saved ? saved.steps : saved.recomputed;
        notify({ tone: "success", message: saved.success || expectedEventToast(mode.kind === "create" ? "create" : "update", count) });
        onClose(); router.refresh();
      } catch { notify({ tone: "error", message: FALLBACK }); }
      finally { submitting.current = false; }
    });
  }
  // CrmDialogFrame owns max-w-[560px], max-h-[92vh], the single tf-button-primary,
  // Ctrl+Enter and the custom "Bỏ nội dung đang ghi?" / "Tiếp tục ghi" decision.
  return <CrmDialogFrame open title={mode.kind === "create" ? "Thêm sự kiện dự kiến" : "Sửa sự kiện dự kiến"} dirty={initial !== JSON.stringify(state)} pending={pending} onClose={onClose} onSubmit={submit} submitLabel="Lưu sự kiện">
    <div ref={root} className="space-y-4" aria-busy={pending}>
      <p className="break-words text-sm text-zinc-500">{clientName}</p>
      {field("programTypeCode", "Loại chương trình", <select {...attrs("programTypeCode")} required className="tf-field" value={state.programTypeCode} onChange={e => set("programTypeCode", e.target.value)}><option value="">Chọn loại chương trình</option>{mode.kind === "edit" && !programTypes.some(p => p.code === state.programTypeCode) && <option value={state.programTypeCode} disabled>{state.programTypeCode} · Đã ẩn</option>}{programTypes.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}</select>)}
      {field("buyingUnitId", "Đơn vị mua", <select {...attrs("buyingUnitId")} className="tf-field" value={state.buyingUnitId} onChange={e => set("buyingUnitId", e.target.value)}><option value="">Không chọn đơn vị mua</option>{mode.kind === "edit" && state.buyingUnitId && !buyingUnits.some(u => u.id === state.buyingUnitId) && <option value={state.buyingUnitId} disabled>{mode.event.buyingUnitName} · Đã ẩn</option>}{buyingUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>)}
      <div data-crm-field="time"><span id={`${uid}-time-label`} className="tf-label">Thời gian</span>
        <div role="radiogroup" aria-labelledby={`${uid}-time-label`} className="mt-2 flex gap-2">{([ ["DAY", "Ngày"], ["MONTH", "Tháng"], ["QUARTER", "Quý"] ] as const).map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={state.precision === key} className={`min-h-10 rounded-[8px] border px-3 py-2 text-sm ${state.precision === key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600"}`} onClick={() => set("precision", key)}>{label}</button>)}</div>
        <div className="mt-3">{state.precision === "DAY" ? <DeadlineField label="Ngày dự kiến" value={state.dateKey} onChange={value => set("dateKey", value)} dateOnly required id={`${uid}-time`} invalid={!!errors.time} describedBy={errors.time ? `${uid}-time-error` : undefined} /> : <div className="grid grid-cols-2 gap-3">
          {state.precision === "MONTH" ? <select {...attrs("time")} required aria-label="Tháng dự kiến" className="tf-field" value={state.month} onChange={e => set("month", e.target.value)}><option value="">Chọn tháng</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>)}</select> : <select {...attrs("time")} required aria-label="Quý dự kiến" className="tf-field" value={state.quarter} onChange={e => set("quarter", e.target.value)}><option value="">Chọn quý</option>{[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}</select>}
          <select required aria-label="Năm dự kiến" aria-invalid={!!errors.time || undefined} aria-describedby={errors.time ? `${uid}-time-error` : undefined} className="tf-field" value={state.year} onChange={e => set("year", e.target.value)}>{Array.from({ length: 5 }, (_, i) => nowYear - 1 + i).map(y => <option key={y} value={y}>{y}</option>)}</select>
        </div>}</div>{error("time")}
      </div>
      <div><span className="tf-label">Mốc nhắc</span><p className="mt-1.5 text-sm text-zinc-600" role="status">{preview.length ? preview.map(s => {
        const date = vnDateKey(s.dueDate).split("-").slice(1).reverse().join("/");
        return s.kind === "VERIFY_MONTH" ? `Xác minh tháng · ${date}` : `${date} (${s.offsetDays} ngày)`;
      }).join(" · ") : "Không có mốc nhắc"}</p></div>
      <div data-crm-field="source"><span id={`${uid}-source-label`} className="tf-label">Nguồn</span><div role="radiogroup" aria-required="true" aria-labelledby={`${uid}-source-label`} aria-invalid={!!errors.source || undefined} aria-describedby={errors.source ? `${uid}-source-error` : undefined} className="mt-2 space-y-2">{EVENT_SOURCES.map(s => <label key={s.key} className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" required name={`${uid}-source`} value={s.key} checked={state.source === s.key} onChange={() => set("source", s.key)} />{s.label}</label>)}</div>{error("source")}</div>
      {field("note", "Ghi chú", <textarea {...attrs("note")} rows={3} maxLength={1000} className="tf-field resize-y" value={state.note} onChange={e => set("note", e.target.value)} />)}
    </div>
  </CrmDialogFrame>;
}
