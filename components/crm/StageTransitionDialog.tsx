"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { advanceOpportunityStageAction } from "@/app/actions/crmOpportunities";
import DeadlineField from "@/components/DeadlineField";
import { useInteraction } from "@/components/InteractionProvider";
import { formatThousandsInput } from "@/lib/crm/opportunityFormat";
import { buildAdvancePayload, validateStageForm, type StageForm } from "@/lib/crm/opportunityDialogForms";
import CrmDialogFrame, { focusCrmError } from "./CrmDialogFrame";

export type StageTransitionDialogProps = {
  opportunityId: string; version: number; to: "BRIEF" | "BIDDING";
  initial: { budgetMin: number | null; budgetMax: number | null; briefSummary: string | null; winStrategy: string | null; proposalDueAt: string | null; proposalPlannedAt: string | null };
  todayKey: string; open: boolean; onOpenChange: (open: boolean) => void;
};
export default function StageTransitionDialog(props: StageTransitionDialogProps) {
  return props.open ? <StageFormBody {...props} /> : null;
}
function StageFormBody({ opportunityId, version, to, initial, todayKey, onOpenChange }: StageTransitionDialogProps) {
  const [state, setState] = useState<StageForm>(() => ({ briefReceivedAt: todayKey, proposalDueAt: initial.proposalDueAt ?? "", proposalPlannedAt: initial.proposalPlannedAt ?? "", budgetMin: initial.budgetMin === null ? "" : formatThousandsInput(String(initial.budgetMin)), budgetMax: initial.budgetMax === null ? "" : formatThousandsInput(String(initial.budgetMax)), briefSummary: initial.briefSummary ?? "", winStrategy: initial.winStrategy ?? "" }));
  const [snapshot] = useState(() => JSON.stringify(state));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const uid = useId();
  const router = useRouter();
  const { notify } = useInteraction();
  function set(key: keyof StageForm, value: string) { setState(s => ({ ...s, [key]: value })); setErrors(e => { const next = { ...e }; delete next[key]; return next; }); }
  function a(key: string) { return { id: `${uid}-${key}`, "aria-invalid": !!errors[key] || undefined, "aria-describedby": errors[key] ? `${uid}-${key}-error` : undefined, style: errors[key] ? { borderColor: "var(--danger)" } : undefined }; }
  function error(key: string) { return errors[key] && <p id={`${uid}-${key}-error`} role="alert" className="mt-1 text-xs text-[var(--danger)]">{errors[key]}</p>; }
  function field(key: string, label: string, child: ReactNode) { return <div data-crm-field={key}><label htmlFor={`${uid}-${key}`} className="tf-label mb-1.5 block">{label}</label>{child}{error(key)}</div>; }
  function date(key: "briefReceivedAt" | "proposalDueAt" | "proposalPlannedAt", label: string, required = false) { return <div data-crm-field={key}><DeadlineField id={`${uid}-${key}`} dateOnly required={required} maxDate={key === "briefReceivedAt" ? todayKey : undefined} label={label} value={state[key] ?? ""} onChange={value => set(key, value)} invalid={!!errors[key]} describedBy={errors[key] ? `${uid}-${key}-error` : undefined} />{error(key)}</div>; }
  function showErrors(next: Record<string, string>) { setErrors(next); requestAnimationFrame(() => focusCrmError(root.current, next, ["briefReceivedAt", "proposalDueAt", "budgetMin", "budgetMax", "briefSummary", "winStrategy", "proposalPlannedAt"])); }
  function submit() {
    if (pending || submitting.current) return;
    const next = validateStageForm(to, state, todayKey);
    if (Object.keys(next).length) { showErrors(next); return; }
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await advanceOpportunityStageAction(buildAdvancePayload(opportunityId, version, to, state));
        if (result.error) { if (result.fieldErrors) showErrors({ ...errors, ...result.fieldErrors }); notify({ tone: "error", message: result.error }); }
        else if (result.success) { notify({ tone: "success", message: result.success }); onOpenChange(false); router.refresh(); }
      } catch { notify({ tone: "error", message: "Không lưu được. Kiểm tra kết nối rồi thử lại." }); }
      finally { submitting.current = false; }
    });
  }
  return <CrmDialogFrame open title={to === "BRIEF" ? "Nhận Brief" : "Bắt đầu Bidding"} dirty={snapshot !== JSON.stringify(state)} pending={pending} onClose={() => onOpenChange(false)} onSubmit={submit} submitLabel={to === "BRIEF" ? "Chuyển sang Brief" : "Chuyển sang Bidding"}>
    <div ref={root} className="space-y-4">
      {to === "BRIEF" ? <>
        {date("briefReceivedAt", "Ngày nhận Brief", true)}
        {date("proposalDueAt", "Hạn nộp đề xuất")}
        <fieldset className="space-y-2"><legend className="tf-label">Ngân sách dự kiến</legend><div className="grid grid-cols-2 gap-2">{([ ["budgetMin", "Từ"], ["budgetMax", "Đến"] ] as const).map(([key, label]) => <div key={key}>{field(key, label, <input {...a(key)} className="tf-field" inputMode="numeric" value={state[key]} onChange={e => set(key, formatThousandsInput(e.target.value))} />)}</div>)}</div></fieldset>
        {field("briefSummary", "Đề bài tóm tắt", <textarea {...a("briefSummary")} className="tf-field" rows={3} maxLength={4000} value={state.briefSummary} onChange={e => set("briefSummary", e.target.value)} />)}
      </> : <>
        {field("winStrategy", "Chiến lược thắng thầu", <textarea {...a("winStrategy")} className="tf-field" rows={3} maxLength={4000} value={state.winStrategy} onChange={e => set("winStrategy", e.target.value)} />)}
        {date("proposalPlannedAt", "Ngày gửi đề xuất dự kiến")}
      </>}
    </div>
  </CrmDialogFrame>;
}
