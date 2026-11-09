"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { openOpportunityAction } from "@/app/actions/crmOpportunities";
import { useInteraction } from "@/components/InteractionProvider";
import type { OpenOpportunityDialogOptions } from "@/lib/crm/dialogOptions";
import { vnDateKey } from "@/lib/crm/dates";
import { OPPORTUNITY_SOURCES } from "@/lib/crm/labels";
import { parseMoneyInput } from "@/lib/crm/opportunityInput";
import { defaultOpportunityName, validateOpenOpportunityInput } from "@/lib/crm/opportunityStage";
import CrmDialogFrame, { focusCrmError } from "./CrmDialogFrame";

export type OpenOpportunitySaved = { success: string; opportunityId: string };
export type OpenOpportunityDialogProps = {
  options: OpenOpportunityDialogOptions;
  triggerLabel?: string;
  triggerVariant: "primary" | "secondary" | "ghost";
  prefill?: { clientId?: string };
  lockClient?: boolean;
  onSaved?: (result: OpenOpportunitySaved) => void;
};
const FIELD_ORDER = ["clientId", "buyingUnitId", "programTypeCode", "expectedYear", "expectedMonth", "name", "source", "demandSignal", "budgetMin", "budgetMax", "picAccountId"];
function moneyText(value: string) {
  if (!/^[\d.,\s]*$/.test(value)) return value;
  return value.replace(/[.,\s]/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
export default function OpenOpportunityDialog(props: OpenOpportunityDialogProps) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={`tf-button-${props.triggerVariant}`} disabled={!props.options.clients.length} onClick={() => setOpen(true)}>{props.triggerLabel ?? "Mở Cơ hội"}</button>
    {open && <OpenOpportunityBody {...props} onClose={() => setOpen(false)} />}
  </>;
}
function OpenOpportunityBody({ options, prefill, lockClient, onSaved, onClose }: OpenOpportunityDialogProps & { onClose: () => void }) {
  const [form, setForm] = useState(() => {
    const clientId = prefill?.clientId ?? "";
    const client = options.clients.find(c => c.id === clientId);
    return {
      clientId, buyingUnitId: "", programTypeCode: "", periodMode: "MONTH", expectedYear: vnDateKey(new Date()).slice(0, 4), expectedPeriod: "",
      name: "", nameEdited: false, source: "OTHER", demandSignal: "", budgetMin: "", budgetMax: "",
      picAccountId: options.picAccounts.find(p => p.id === client?.picAccountId)?.id ?? "",
    };
  });
  const [initial] = useState(() => JSON.stringify(form));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const uid = useId();
  const router = useRouter();
  const { notify } = useInteraction();
  const client = options.clients.find(c => c.id === form.clientId);
  const program = options.programTypes.find(p => p.code === form.programTypeCode);
  const generatedName = program ? defaultOpportunityName(program.label, Number(form.expectedYear)) : "";
  const name = form.nameEdited ? form.name : generatedName;
  function set(key: keyof typeof form, value: string | boolean) {
    setForm(s => ({ ...s, [key]: value }));
    setErrors(e => { const next = { ...e }; delete next[key]; return next; });
  }
  function a(field: string) {
    return { id: `${uid}-${field}`, "aria-invalid": !!errors[field] || undefined, "aria-describedby": errors[field] ? `${uid}-${field}-error` : undefined, style: errors[field] ? { borderColor: "var(--danger)" } : undefined };
  }
  function field(key: string, label: string, children: ReactNode) {
    return <div data-crm-field={key}>
      <label htmlFor={`${uid}-${key}`} className="tf-label mb-1.5 block">{label}</label>
      {children}
      {errors[key] && <p role="alert" id={`${uid}-${key}-error`} className="mt-1 text-xs text-[var(--danger)]">{errors[key]}</p>}
    </div>;
  }
  function showErrors(next: Record<string, string>) {
    setErrors(next); requestAnimationFrame(() => focusCrmError(root.current, next, FIELD_ORDER));
  }
  function submit() {
    if (pending || submitting.current) return;
    const payload = {
      clientId: form.clientId, buyingUnitId: form.buyingUnitId || null, programTypeCode: form.programTypeCode,
      expectedYear: Number(form.expectedYear), expectedMonth: form.periodMode === "MONTH" ? Number(form.expectedPeriod) : null,
      expectedQuarter: form.periodMode === "QUARTER" ? Number(form.expectedPeriod) : null,
      name, source: form.source, demandSignal: form.demandSignal,
      budgetMin: form.budgetMin ? parseMoneyInput(form.budgetMin) : null, budgetMax: form.budgetMax ? parseMoneyInput(form.budgetMax) : null,
      picAccountId: form.picAccountId || null,
    };
    const parsed = validateOpenOpportunityInput(payload);
    const next: Record<string, string> = "errors" in parsed ? { ...parsed.errors } : {};
    if (!client) next.clientId = "Chọn khách hàng.";
    if (!program) next.programTypeCode = "Chọn loại chương trình.";
    for (const key of ["budgetMin", "budgetMax"] as const) if (form[key] && payload[key] === null) next[key] = "Ngân sách dự kiến không hợp lệ.";
    if (Object.keys(next).length) { showErrors(next); return; }
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await openOpportunityAction(payload);
        if ("error" in result && result.error) {
          if (result.fieldErrors) showErrors(result.fieldErrors);
          notify({ message: result.error, tone: "error" }); return;
        }
        if (result.success && result.opportunityId) {
          notify({ message: result.success, tone: "success" }); onClose(); onSaved?.({ success: result.success, opportunityId: result.opportunityId }); router.refresh();
        }
      } catch { notify({ message: "Không lưu được. Kiểm tra kết nối rồi thử lại.", tone: "error" }); }
      finally { submitting.current = false; }
    });
  }
  return <CrmDialogFrame open title="Mở Cơ hội" dirty={initial !== JSON.stringify(form)} pending={pending} onClose={onClose} onSubmit={submit} submitLabel="Mở Cơ hội">
    <div ref={root} className="space-y-4">
      {field("clientId", "Khách hàng", <select {...a("clientId")} disabled={lockClient} className="tf-field" value={form.clientId} onChange={e => {
        const selected = options.clients.find(c => c.id === e.target.value);
        setForm(s => ({ ...s, clientId: e.target.value, buyingUnitId: "", picAccountId: options.picAccounts.find(p => p.id === selected?.picAccountId)?.id ?? "" }));
      }}>
        <option value="">Chọn khách hàng</option>
        {options.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>)}
      {field("buyingUnitId", "Đơn vị mua", <select {...a("buyingUnitId")} className="tf-field" value={form.buyingUnitId} onChange={e => set("buyingUnitId", e.target.value)}>
        <option value="">Không chọn</option>
        {client?.buyingUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
      </select>)}
      {field("programTypeCode", "Loại chương trình", <select {...a("programTypeCode")} className="tf-field" value={form.programTypeCode} onChange={e => set("programTypeCode", e.target.value)}>
        <option value="">Chọn loại chương trình</option>
        {options.programTypes.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
      </select>)}
      {field("expectedMonth", "Tháng hoặc quý dự kiến", <div className="grid grid-cols-3 gap-2">
        <select aria-label="Tháng hoặc quý" className="tf-field" value={form.periodMode} onChange={e => { set("periodMode", e.target.value); set("expectedPeriod", ""); }}>
          <option value="MONTH">Tháng</option><option value="QUARTER">Quý</option>
        </select>
        <select {...a("expectedMonth")} aria-label={form.periodMode === "MONTH" ? "Tháng dự kiến" : "Quý dự kiến"} className="tf-field" value={form.expectedPeriod} onChange={e => set("expectedPeriod", e.target.value)}>
          <option value="">Chọn</option>
          {Array.from({ length: form.periodMode === "MONTH" ? 12 : 4 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
        <div data-crm-field="expectedYear"><input {...a("expectedYear")} aria-label="Năm dự kiến" inputMode="numeric" className="tf-field" value={form.expectedYear} onChange={e => set("expectedYear", e.target.value)} /></div>
      </div>)}
      {errors.expectedYear && <p role="alert" id={`${uid}-expectedYear-error`} className="text-xs text-[var(--danger)]">{errors.expectedYear}</p>}
      {field("name", "Tên Cơ hội", <input {...a("name")} className="tf-field" maxLength={200} value={name} onChange={e => setForm(s => ({ ...s, name: e.target.value, nameEdited: true }))} />)}
      {field("source", "Nguồn", <select {...a("source")} className="tf-field" value={form.source} onChange={e => set("source", e.target.value)}>
        {OPPORTUNITY_SOURCES.map(source => <option key={source.key} value={source.key}>{source.label}</option>)}
      </select>)}
      {field("demandSignal", "Tín hiệu nhu cầu", <textarea {...a("demandSignal")} className="tf-field" maxLength={2000} rows={3} value={form.demandSignal} onChange={e => set("demandSignal", e.target.value)} />)}
      <div className="grid gap-3 sm:grid-cols-2">
        {field("budgetMin", "Ngân sách dự kiến từ", <input {...a("budgetMin")} inputMode="numeric" className="tf-field tabular-nums" value={form.budgetMin} onChange={e => set("budgetMin", moneyText(e.target.value))} />)}
        {field("budgetMax", "Ngân sách dự kiến đến", <input {...a("budgetMax")} inputMode="numeric" className="tf-field tabular-nums" value={form.budgetMax} onChange={e => set("budgetMax", moneyText(e.target.value))} />)}
      </div>
      {field("picAccountId", "PIC", <select {...a("picAccountId")} className="tf-field" value={form.picAccountId} onChange={e => set("picAccountId", e.target.value)}>
        <option value="">Chưa giao</option>
        {options.picAccounts.map(pic => <option key={pic.id} value={pic.id}>{pic.name}</option>)}
      </select>)}
    </div>
  </CrmDialogFrame>;
}
