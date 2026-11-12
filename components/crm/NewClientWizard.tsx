"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkClientDuplicatesAction, createClientWizardAction } from "@/app/actions/crmClients";
import DeadlineField from "@/components/DeadlineField";
import UserPicker from "@/components/UserPicker";
import { useInteraction } from "@/components/InteractionProvider";
import type { DuplicateMatch, NewClientWizardOptions } from "@/lib/crm/clientService";
import CrmDialogFrame from "./CrmDialogFrame";

type Form = {
  taxCode: string; name: string; teamName: string;
  industry: string; parentClientId: string; acquisitionSource: string; referredBy: string; potentialLevel: string;
  picAccountId: string; responsibleTeamId: string; tagIds: string[];
  nextTitle: string; nextAssigneeId: string; nextDueDate: string;
};
const STEPS = ["Công ty", "Phân loại và phụ trách", "Bước tiếp theo"] as const;
const STEP_OF: Record<string, number> = { name: 0, taxCode: 0, teamName: 0, industry: 1, parentClientId: 1, acquisitionSource: 1, referredBy: 1, potentialLevel: 1, picAccountId: 1, responsibleTeamId: 1, tagIds: 1, next: 2 };
const REASON: Record<DuplicateMatch["reason"], string> = { TAX_CODE: "cùng MST", ALIAS: "trùng tên gọi khác", NAME: "tên gần giống" };

/** crm51 (sketch 006 screen 3): three steps, only the name is required, "Tạo ngay" saves from any step. */
export default function NewClientWizard({ options }: { options: NewClientWizardOptions }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="tf-button-primary" onClick={() => setOpen(true)}>+ Thêm khách</button>
    {open && <WizardBody options={options} onClose={() => setOpen(false)} />}
  </>;
}

function WizardBody({ options, onClose }: { options: NewClientWizardOptions; onClose: () => void }) {
  const initial: Form = { taxCode: "", name: "", teamName: "", industry: "", parentClientId: "", acquisitionSource: "", referredBy: "", potentialLevel: "", picAccountId: options.defaults.picAccountId ?? "", responsibleTeamId: "", tagIds: [], nextTitle: "", nextAssigneeId: options.defaults.assigneeId, nextDueDate: "" };
  const [form, setForm] = useState<Form>(initial);
  const [snapshot] = useState(() => JSON.stringify(initial));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [allowSimilar, setAllowSimilar] = useState(false);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const uid = useId();
  const router = useRouter();
  const { notify } = useInteraction();
  const tooShort = form.name.trim().length < 2 && form.taxCode.trim().length < 10 && form.teamName.trim().length < 2;
  const shownDuplicates = tooShort ? [] : duplicates;
  const exact = shownDuplicates.filter(d => d.exact);
  const similar = shownDuplicates.filter(d => !d.exact);

  // Live, read-only duplicate check while typing (debounced; the server action is rate limited).
  useEffect(() => {
    const name = form.name.trim(), taxCode = form.taxCode.trim(), teamName = form.teamName.trim();
    if (name.length < 2 && taxCode.length < 10 && teamName.length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await checkClientDuplicatesAction({ name, taxCode, teamName });
        if (live && "duplicates" in result) { setDuplicates(result.duplicates ?? []); setAllowSimilar(false); }
      } catch { /* the create call re-checks on the server */ }
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [form.name, form.taxCode, form.teamName]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(f => ({ ...f, [key]: value }));
    const errorKey = key.startsWith("next") ? "next" : key;
    setErrors(e => { const next = { ...e }; delete next[errorKey]; return next; });
  }
  function fail(field: string | undefined, message: string) {
    const key = field && field in STEP_OF ? field : "form";
    setErrors({ [key]: message });
    if (key !== "form") setStep(STEP_OF[key]);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-crm-field="${key}"] input, [data-crm-field="${key}"] select, [data-crm-field="${key}"] button`)?.focus());
  }
  function submit() {
    if (pending || submitting.current) return;
    if (!form.name.trim()) { fail("name", "Nhập tên khách."); return; }
    const wantsNext = !!(form.nextTitle.trim() || form.nextDueDate);
    if (wantsNext && (!form.nextTitle.trim() || !form.nextDueDate || !form.nextAssigneeId)) { fail("next", "Nhập việc, người làm và hạn, hoặc để trống cả ba."); return; }
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await createClientWizardAction({
          name: form.name, taxCode: form.taxCode, teamName: form.teamName, industry: form.industry, parentClientId: form.parentClientId,
          acquisitionSource: form.acquisitionSource, referredBy: form.referredBy, potentialLevel: form.potentialLevel,
          picAccountId: form.picAccountId, responsibleTeamId: form.responsibleTeamId, tagIds: form.tagIds, allowSimilar,
          next: wantsNext ? { title: form.nextTitle, assigneeId: form.nextAssigneeId, dueDate: form.nextDueDate } : null,
        });
        if ("success" in result && result.success && "id" in result) { notify({ tone: "success", message: result.success }); onClose(); router.push(`/crm/clients/${result.id}`); return; }
        if ("duplicates" in result && Array.isArray(result.duplicates)) setDuplicates(result.duplicates);
        fail("field" in result ? result.field as string | undefined : undefined, ("error" in result && result.error) || "Không lưu được. Kiểm tra kết nối rồi thử lại.");
      } catch { notify({ tone: "error", message: "Không lưu được. Kiểm tra kết nối rồi thử lại." }); }
      finally { submitting.current = false; }
    });
  }
  const field = (key: string, label: string, control: React.ReactNode, required = false) => <div data-crm-field={key} className="min-w-0">
    <label htmlFor={`${uid}-${key}`} className="tf-label mb-1.5 block">{label}{required && <span aria-hidden="true" className="text-[var(--danger)]"> *</span>}</label>
    {control}
    {errors[key] && <p id={`${uid}-${key}-error`} role="alert" className="mt-1 text-xs text-[var(--danger)]">{errors[key]}</p>}
  </div>;
  const a = (key: string) => ({ id: `${uid}-${key}`, "aria-invalid": !!errors[key] || undefined, "aria-describedby": errors[key] ? `${uid}-${key}-error` : undefined, disabled: pending });
  const blocked = exact.length > 0 || (similar.length > 0 && !allowSimilar);
  const footer = <div className="flex flex-wrap items-center justify-between gap-2">
    {step > 0 ? <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => setStep(s => s - 1)}>Quay lại</button> : <span />}
    <div className="flex flex-wrap gap-2">
      {step < 2 && <button type="submit" className="tf-button-secondary" disabled={pending || blocked} aria-busy={pending}>{pending && <span className="tf-spinner" aria-hidden="true" />}Tạo ngay</button>}
      {step < 2 ? <button type="button" className="tf-button-primary" disabled={pending} onClick={() => { if (step === 0 && !form.name.trim()) { fail("name", "Nhập tên khách."); return; } setStep(s => s + 1); }}>Tiếp: {STEPS[step + 1]}</button>
        : <button type="submit" className="tf-button-primary" disabled={pending || blocked} aria-busy={pending}>{pending && <span className="tf-spinner" aria-hidden="true" />}Tạo khách</button>}
    </div>
  </div>;
  return <CrmDialogFrame open title="Thêm khách hàng" dirty={snapshot !== JSON.stringify(form)} pending={pending} onClose={onClose} onSubmit={submit} submitLabel="Tạo khách" footer={footer}>
    <div ref={root} className="space-y-4">
      <ol aria-label="Các bước" className="grid grid-cols-3 gap-1.5">{STEPS.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined}>
        <span aria-hidden="true" className={`block h-1 rounded-full ${index <= step ? "bg-brand-400" : "bg-zinc-200"}`} />
        <button type="button" disabled={pending || (index > 0 && !form.name.trim())} onClick={() => setStep(index)} className={`mt-1.5 text-left text-xs ${index === step ? "font-semibold text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}>{index + 1} {label}</button>
      </li>)}</ol>
      {errors.form && <p role="alert" className="text-sm text-[var(--danger)]">{errors.form}</p>}
      {step === 0 && <>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("taxCode", "Mã số thuế", <input {...a("taxCode")} className="tf-field" inputMode="numeric" maxLength={20} autoComplete="off" value={form.taxCode} onChange={e => set("taxCode", e.target.value)} />)}
          {field("teamName", "Tên gọi trong team", <input {...a("teamName")} className="tf-field" maxLength={160} autoComplete="off" value={form.teamName} onChange={e => set("teamName", e.target.value)} />)}
        </div>
        {field("name", "Tên công ty", <input {...a("name")} className="tf-field" maxLength={160} autoComplete="off" required value={form.name} onChange={e => set("name", e.target.value)} />, true)}
        {exact.length > 0 && <div role="status" className="space-y-1 rounded-[12px] border border-[#fed7aa] bg-[#fff4ed] px-3 py-2.5 text-sm">
          {exact.map(d => <p key={d.id}>Đã có <b>{d.name}</b> ({REASON[d.reason]}{d.picName ? `, PIC ${d.picName}` : ""}, {d.projectCount} Project{d.archived ? ", đang lưu trữ" : ""}). <Link href={`/crm/clients/${d.id}`} className="font-semibold underline underline-offset-2">Mở khách đó</Link></p>)}
        </div>}
        {exact.length === 0 && similar.length > 0 && <div role="status" className="space-y-2 rounded-[12px] border border-[#fed7aa] bg-[#fff4ed] px-3 py-2.5 text-sm">
          {similar.map(d => <p key={d.id}>Có thể trùng: <b>{d.name}</b> ({REASON[d.reason]}{d.picName ? `, PIC ${d.picName}` : ""}, {d.projectCount} Project). <Link href={`/crm/clients/${d.id}`} className="font-semibold underline underline-offset-2">Mở khách đó</Link></p>)}
          <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={allowSimilar} disabled={pending} onChange={e => setAllowSimilar(e.target.checked)} />Vẫn tạo mới</label>
        </div>}
      </>}
      {step === 1 && <>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("industry", "Ngành", options.industries.length
            ? <select {...a("industry")} className="tf-field" value={form.industry} onChange={e => set("industry", e.target.value)}><option value="">Chưa chọn</option>{options.industries.map(i => <option key={i} value={i}>{i}</option>)}</select>
            : <input {...a("industry")} className="tf-field" maxLength={120} value={form.industry} onChange={e => set("industry", e.target.value)} />)}
          {field("parentClientId", "Công ty mẹ", <select {...a("parentClientId")} className="tf-field" value={form.parentClientId} onChange={e => set("parentClientId", e.target.value)}><option value="">Không có</option>{options.parents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>)}
          {field("acquisitionSource", "Nguồn khách", options.sources.length
            ? <select {...a("acquisitionSource")} className="tf-field" value={form.acquisitionSource} onChange={e => set("acquisitionSource", e.target.value)}><option value="">Chưa chọn</option>{options.sources.map(s => <option key={s} value={s}>{s}</option>)}</select>
            : <input {...a("acquisitionSource")} className="tf-field" maxLength={80} value={form.acquisitionSource} onChange={e => set("acquisitionSource", e.target.value)} />)}
          {field("referredBy", "Người giới thiệu", <input {...a("referredBy")} className="tf-field" maxLength={200} value={form.referredBy} onChange={e => set("referredBy", e.target.value)} />)}
        </div>
        {options.canScore && options.potentialScale.length > 0 && <fieldset data-crm-field="potentialLevel" className="min-w-0">
          <legend className="tf-label mb-1.5">Tiềm năng ban đầu</legend>
          <div className="flex flex-wrap gap-1.5">{[{ key: "", label: "Chưa rõ" }, ...options.potentialScale].map(p => <button key={p.key || "none"} type="button" aria-pressed={form.potentialLevel === p.key} disabled={pending} onClick={() => set("potentialLevel", p.key)}
            className={`min-h-10 flex-1 rounded-[10px] border px-3 text-sm transition-colors duration-150 md:min-h-9 ${form.potentialLevel === p.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"}`}>{p.label}</button>)}</div>
          {errors.potentialLevel && <p role="alert" className="mt-1 text-xs text-[var(--danger)]">{errors.potentialLevel}</p>}
        </fieldset>}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("picAccountId", "PIC", <select {...a("picAccountId")} className="tf-field" value={form.picAccountId} onChange={e => set("picAccountId", e.target.value)}><option value="">Chưa giao</option>{options.picAccounts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>)}
          {field("responsibleTeamId", "Team", <select {...a("responsibleTeamId")} className="tf-field" value={form.responsibleTeamId} onChange={e => set("responsibleTeamId", e.target.value)}><option value="">Theo team của PIC</option>{options.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>)}
        </div>
        {options.tags.length > 0 && <fieldset data-crm-field="tagIds" className="min-w-0">
          <legend className="tf-label mb-1.5">Nhãn</legend>
          <div className="flex flex-wrap gap-1.5">{options.tags.map(tag => { const on = form.tagIds.includes(tag.id); return <button key={tag.id} type="button" aria-pressed={on} disabled={pending} onClick={() => set("tagIds", on ? form.tagIds.filter(t => t !== tag.id) : [...form.tagIds, tag.id])}
            className={`min-h-9 rounded-full border px-3 text-xs transition-colors duration-150 ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"}`}>{tag.label}</button>; })}</div>
          {errors.tagIds && <p role="alert" className="mt-1 text-xs text-[var(--danger)]">{errors.tagIds}</p>}
        </fieldset>}
      </>}
      {step === 2 && <div data-crm-field="next" className="space-y-3">
        <div><label htmlFor={`${uid}-nextTitle`} className="tf-label mb-1.5 block">Việc tiếp theo</label><input id={`${uid}-nextTitle`} className="tf-field" maxLength={200} disabled={pending} aria-invalid={!!errors.next || undefined} aria-describedby={errors.next ? `${uid}-next-error` : undefined} value={form.nextTitle} onChange={e => set("nextTitle", e.target.value)} placeholder="Gọi giới thiệu năng lực" /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><span className="tf-label mb-1.5 block">Người làm</span><UserPicker options={options.users} value={form.nextAssigneeId} onChange={value => set("nextAssigneeId", value)} ariaLabel="Người làm" disabled={pending} /></div>
          <DeadlineField id={`${uid}-nextDueDate`} dateOnly label="Hạn" value={form.nextDueDate} onChange={value => set("nextDueDate", value)} invalid={!!errors.next && !form.nextDueDate} describedBy={errors.next ? `${uid}-next-error` : undefined} />
        </div>
        {errors.next && <p id={`${uid}-next-error`} role="alert" className="text-xs text-[var(--danger)]">{errors.next}</p>}
      </div>}
    </div>
  </CrmDialogFrame>;
}
