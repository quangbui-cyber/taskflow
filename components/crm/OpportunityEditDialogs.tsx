"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { editOpportunityAction, changeOpportunityPicOrTeamAction, type CrmOpportunityActionState } from "@/app/actions/crmOpportunities";
import DeadlineField from "@/components/DeadlineField";
import { useInteraction } from "@/components/InteractionProvider";
import { OPPORTUNITY_SOURCES } from "@/lib/crm/labels";
import { formatThousandsInput, parseThousandsInput } from "@/lib/crm/opportunityFormat";
import { parseEditPayload } from "@/lib/crm/opportunityInput";
import { validateOpenOpportunityInput } from "@/lib/crm/opportunityStage";
import CrmDialogFrame, { focusCrmError } from "./CrmDialogFrame";

export type EditableOpportunity = {
  id: string; name: string; version: number; stage: string; outcome: string | null; clientId: string;
  budgetMin: number | null; budgetMax: number | null; picUserId: string | null; picAccountId: string | null; responsibleTeamId: string | null;
  buyingUnitId: string | null; programTypeCode: string; expectedYear: number; expectedMonth: number | null; expectedQuarter: number | null;
  source: string; demandSignal: string; briefSummary: string | null; winStrategy: string | null; proposalDueAt: string | null; proposalPlannedAt: string | null;
};
type Option = { id: string; name: string };
type Controlled = { open: boolean; onOpenChange: (open: boolean) => void };
type EditProps = Controlled & { opportunity: EditableOpportunity; programTypes: { code: string; label: string }[]; buyingUnits: Option[] };
type PicProps = Controlled & { opportunity: EditableOpportunity; picAccounts: Option[]; teams: Option[] };
function useDialogSave(onOpenChange: (open: boolean) => void, order: string[]) {
  const root = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const uid = useId();
  const { notify } = useInteraction();
  const router = useRouter();
  function showErrors(next: Record<string, string>) { setErrors(next); requestAnimationFrame(() => focusCrmError(root.current, next, order)); }
  function clear(key: string) { setErrors(e => { const next = { ...e }; delete next[key]; return next; }); }
  function a(key: string) { return { id: `${uid}-${key}`, "aria-invalid": !!errors[key] || undefined, "aria-describedby": errors[key] ? `${uid}-${key}-error` : undefined, style: errors[key] ? { borderColor: "var(--danger)" } : undefined }; }
  function error(key: string) { return errors[key] && <p id={`${uid}-${key}-error`} role="alert" className="mt-1 text-xs text-[var(--danger)]">{errors[key]}</p>; }
  function field(key: string, label: string, child: ReactNode) { return <div data-crm-field={key}><label htmlFor={`${uid}-${key}`} className="tf-label mb-1.5 block">{label}</label>{child}{error(key)}</div>; }
  function save(action: () => Promise<CrmOpportunityActionState>, next: Record<string, string>) {
    if (pending || submitting.current) return;
    if (Object.keys(next).length) { showErrors(next); return; }
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) { if (result.fieldErrors) showErrors({ ...errors, ...result.fieldErrors }); notify({ tone: "error", message: result.error }); }
        else if (result.success) { notify({ tone: "success", message: result.success }); onOpenChange(false); router.refresh(); }
      } catch { notify({ tone: "error", message: "Không lưu được. Kiểm tra kết nối rồi thử lại." }); }
      finally { submitting.current = false; }
    });
  }
  return { root, errors, uid, pending, showErrors, clear, a, error, field, save };
}
export function EditOpportunityDialog(props: EditProps) { return props.open ? <EditBody {...props} /> : null; }
function EditBody({ opportunity: o, programTypes, buyingUnits, onOpenChange }: EditProps) {
  const [s, setState] = useState(() => ({ name: o.name, programTypeCode: o.programTypeCode, buyingUnitId: o.buyingUnitId ?? "", periodMode: o.expectedQuarter ? "QUARTER" : "MONTH", expectedPeriod: String(o.expectedMonth ?? o.expectedQuarter ?? ""), expectedYear: String(o.expectedYear), source: o.source, demandSignal: o.demandSignal, budgetMin: o.budgetMin === null ? "" : formatThousandsInput(String(o.budgetMin)), budgetMax: o.budgetMax === null ? "" : formatThousandsInput(String(o.budgetMax)), proposalDueAt: o.proposalDueAt ?? "", briefSummary: o.briefSummary ?? "", winStrategy: o.winStrategy ?? "", proposalPlannedAt: o.proposalPlannedAt ?? "" }));
  const [snapshot] = useState(() => JSON.stringify(s));
  const { root, errors, uid, pending, clear, a, error, field, save } = useDialogSave(onOpenChange, ["name", "programTypeCode", "buyingUnitId", "expectedMonth", "expectedYear", "source", "demandSignal", "budgetMin", "budgetMax", "proposalDueAt", "briefSummary", "winStrategy", "proposalPlannedAt"]);
  function set(key: keyof typeof s, value: string) { setState(prev => ({ ...prev, [key]: value })); clear(key); }
  function date(key: "proposalDueAt" | "proposalPlannedAt", label: string) { return <div data-crm-field={key}><DeadlineField dateOnly id={`${uid}-${key}`} label={label} value={s[key]} onChange={v => set(key, v)} invalid={!!errors[key]} describedBy={errors[key] ? `${uid}-${key}-error` : undefined} />{error(key)}</div>; }
  function submit() {
    const payload = { opportunityId: o.id, expectedVersion: o.version, name: s.name.trim(), programTypeCode: s.programTypeCode, buyingUnitId: s.buyingUnitId || null, expectedYear: Number(s.expectedYear), expectedMonth: s.periodMode === "MONTH" ? Number(s.expectedPeriod) : null, expectedQuarter: s.periodMode === "QUARTER" ? Number(s.expectedPeriod) : null, source: s.source, demandSignal: s.demandSignal.trim(), budgetMin: s.budgetMin ? parseThousandsInput(s.budgetMin) : null, budgetMax: s.budgetMax ? parseThousandsInput(s.budgetMax) : null,
      ...(o.stage !== "CARE" ? { proposalDueAt: s.proposalDueAt || null, briefSummary: s.briefSummary.trim() || null } : {}),
      ...(o.stage === "BIDDING" ? { winStrategy: s.winStrategy.trim() || null, proposalPlannedAt: s.proposalPlannedAt || null } : {}),
    };
    const checked = validateOpenOpportunityInput({ ...payload, clientId: o.clientId });
    const next = "errors" in checked ? { ...checked.errors } : {};
    if (!s.name.trim()) next.name = "Nhập tên Cơ hội.";
    if (!programTypes.some(p => p.code === s.programTypeCode)) next.programTypeCode = "Chọn loại chương trình.";
    if (s.buyingUnitId && !buyingUnits.some(u => u.id === s.buyingUnitId)) next.buyingUnitId = "Chọn đơn vị mua.";
    for (const key of ["budgetMin", "budgetMax"] as const) if (s[key] && payload[key] === null) next[key] = "Ngân sách dự kiến không hợp lệ.";
    const parsed = parseEditPayload(payload);
    save(() => editOpportunityAction(payload), { ...next, ...("fieldErrors" in parsed ? parsed.fieldErrors : {}) });
  }
  return <CrmDialogFrame open title="Sửa thông tin" dirty={snapshot !== JSON.stringify(s)} pending={pending} onClose={() => onOpenChange(false)} onSubmit={submit} submitLabel="Lưu thay đổi">
    <div ref={root} className="space-y-4">
      {field("name", "Tên Cơ hội", <input {...a("name")} required maxLength={200} className="tf-field" value={s.name} onChange={e => set("name", e.target.value)} />)}
      {field("programTypeCode", "Loại chương trình", <select {...a("programTypeCode")} required className="tf-field" value={s.programTypeCode} onChange={e => set("programTypeCode", e.target.value)}>{programTypes.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}</select>)}
      {field("buyingUnitId", "Đơn vị mua", <select {...a("buyingUnitId")} className="tf-field" value={s.buyingUnitId} onChange={e => set("buyingUnitId", e.target.value)}><option value="">Không chọn</option>{buyingUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>)}
      <div data-crm-field="expectedMonth"><span id={`${uid}-period-label`} className="tf-label">Tháng hoặc quý dự kiến</span>
        <div role="radiogroup" aria-labelledby={`${uid}-period-label`} className="mt-2 flex gap-2">{([ ["MONTH", "Tháng"], ["QUARTER", "Quý"] ] as const).map(([value, label]) => <label key={value} className={`cursor-pointer rounded-[8px] border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-zinc-400 ${s.periodMode === value ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600"}`}><input type="radio" className="sr-only" name={`${uid}-period`} checked={s.periodMode === value} onChange={() => { set("periodMode", value); set("expectedPeriod", ""); clear("expectedMonth"); }} />{label}</label>)}</div>
        <div className="mt-2 grid grid-cols-2 gap-2"><select {...a("expectedMonth")} aria-label={s.periodMode === "MONTH" ? "Tháng dự kiến" : "Quý dự kiến"} className="tf-field" value={s.expectedPeriod} onChange={e => { set("expectedPeriod", e.target.value); clear("expectedMonth"); }}><option value="">Chọn</option>{Array.from({ length: s.periodMode === "MONTH" ? 12 : 4 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select><div data-crm-field="expectedYear"><input {...a("expectedYear")} aria-label="Năm dự kiến" inputMode="numeric" className="tf-field" value={s.expectedYear} onChange={e => set("expectedYear", e.target.value)} />{error("expectedYear")}</div></div>{error("expectedMonth")}
      </div>
      {field("source", "Nguồn", <select {...a("source")} className="tf-field" value={s.source} onChange={e => set("source", e.target.value)}>{OPPORTUNITY_SOURCES.map(source => <option key={source.key} value={source.key}>{source.label}</option>)}</select>)}
      {field("demandSignal", "Tín hiệu nhu cầu", <textarea {...a("demandSignal")} required maxLength={2000} rows={3} className="tf-field" value={s.demandSignal} onChange={e => set("demandSignal", e.target.value)} />)}
      <fieldset className="space-y-2"><legend className="tf-label">Ngân sách dự kiến</legend><div className="grid grid-cols-2 gap-2">{([ ["budgetMin", "Từ"], ["budgetMax", "Đến"] ] as const).map(([key, label]) => <div key={key}>{field(key, label, <input {...a(key)} inputMode="numeric" className="tf-field" value={s[key]} onChange={e => set(key, formatThousandsInput(e.target.value))} />)}</div>)}</div></fieldset>
      {o.stage !== "CARE" && <>{date("proposalDueAt", "Hạn nộp đề xuất")}{field("briefSummary", "Đề bài tóm tắt", <textarea {...a("briefSummary")} rows={3} maxLength={4000} className="tf-field" value={s.briefSummary} onChange={e => set("briefSummary", e.target.value)} />)}</>}
      {o.stage === "BIDDING" && <>{field("winStrategy", "Chiến lược thắng thầu", <textarea {...a("winStrategy")} rows={3} maxLength={4000} className="tf-field" value={s.winStrategy} onChange={e => set("winStrategy", e.target.value)} />)}{date("proposalPlannedAt", "Ngày gửi đề xuất dự kiến")}</>}
    </div>
  </CrmDialogFrame>;
}
export function OpportunityPicDialog(props: PicProps) { return props.open ? <PicBody {...props} /> : null; }
function PicBody({ opportunity: o, picAccounts, teams, onOpenChange }: PicProps) {
  const [s, set] = useState(() => ({ picAccountId: o.picAccountId ?? "", responsibleTeamId: o.responsibleTeamId ?? "" }));
  const [snapshot] = useState(() => JSON.stringify(s));
  const { root, pending, clear, a, field, save } = useDialogSave(onOpenChange, ["picAccountId", "responsibleTeamId"]);
  return <CrmDialogFrame open title="Đổi PIC hoặc team" dirty={snapshot !== JSON.stringify(s)} pending={pending} onClose={() => onOpenChange(false)} submitLabel="Lưu thay đổi" onSubmit={() => save(() => changeOpportunityPicOrTeamAction({ opportunityId: o.id, expectedVersion: o.version, picAccountId: s.picAccountId, responsibleTeamId: s.responsibleTeamId || null }), s.picAccountId ? {} : { picAccountId: "Chọn PIC." })}>
    <div ref={root} className="space-y-4">
      {field("picAccountId", "PIC", <select {...a("picAccountId")} required className="tf-field" value={s.picAccountId} onChange={e => { set(prev => ({ ...prev, picAccountId: e.target.value })); clear("picAccountId"); }}><option value="">Chọn PIC</option>{picAccounts.map(pic => <option key={pic.id} value={pic.id}>{pic.name}</option>)}</select>)}
      {field("responsibleTeamId", "Team phụ trách", <select {...a("responsibleTeamId")} className="tf-field" value={s.responsibleTeamId} onChange={e => { set(prev => ({ ...prev, responsibleTeamId: e.target.value })); clear("responsibleTeamId"); }}><option value="">Theo team của PIC</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>)}
    </div>
  </CrmDialogFrame>;
}
