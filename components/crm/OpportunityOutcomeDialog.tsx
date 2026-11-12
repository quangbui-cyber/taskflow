"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { closeOpportunityAction, winOpportunityAction } from "@/app/actions/crmOpportunities";
import DeadlineField from "@/components/DeadlineField";
import UserPicker, { type UserPickerOption } from "@/components/UserPicker";
import { useInteraction } from "@/components/InteractionProvider";
import { OPPORTUNITY_OUTCOMES } from "@/lib/crm/labels";
import { formatBudgetRange, formatThousandsInput } from "@/lib/crm/opportunityFormat";
import { allowedOutcomes, validateOutcomeForm, reasonGroupFor, buildWinPayload, buildClosePayload, outcomeFooterLines, type OutcomeForm, type OutcomeReasons, type OpportunityStage } from "@/lib/crm/opportunityDialogForms";
import CrmDialogFrame, { focusCrmError } from "./CrmDialogFrame";

export type OpportunityOutcomeDialogProps = {
  opportunityId: string; opportunityName: string; version: number; mode: "RESULT" | "END"; stage: OpportunityStage; outcome: string | null;
  budgetMin: number | null; budgetMax: number | null; reasons: OutcomeReasons; winPreview: { tasks: number; files: number; meetings: number } | null;
  openBidPrepTaskCount: number; competitors?: { id: string; name: string }[]; users: UserPickerOption[]; defaultAssigneeId: string | null; todayKey: string; open: boolean; onOpenChange: (open: boolean) => void;
};
export default function OpportunityOutcomeDialog(props: OpportunityOutcomeDialogProps) {
  return props.open ? <OutcomeFormBody {...props} /> : null;
}
function OutcomeFormBody(props: OpportunityOutcomeDialogProps) {
  const { opportunityId, opportunityName, version, mode, stage, outcome, reasons, winPreview, openBidPrepTaskCount, users, todayKey, onOpenChange } = props;
  const [state, setState] = useState<OutcomeForm>(() => ({ outcome: null, contractValue: "", wonAt: todayKey, projectName: opportunityName, reasonId: "", note: "", lessons: "", followUp: false, followUpTitle: "", assigneeId: users.find(u => u.id === props.defaultAssigneeId)?.id ?? null, dueDate: "" }));
  const [snapshot] = useState(() => JSON.stringify(state));
  const [winnerId, setWinnerId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const uid = useId();
  const { notify } = useInteraction();
  const router = useRouter();
  const choices = allowedOutcomes(stage, outcome);
  const group = reasonGroupFor(state.outcome);
  const catalog = group ? reasons[group] : [];
  const won = state.outcome === "WON";
  const budget = formatBudgetRange(props.budgetMin, props.budgetMax);
  function set<K extends keyof OutcomeForm>(key: K, value: OutcomeForm[K]) {
    setState(s => ({ ...s, [key]: value }));
    setErrors(e => { const next = { ...e }; delete next[key]; if (["followUpTitle", "dueDate", "followUp"].includes(key)) delete next.followUp; return next; });
  }
  function a(key: string) { return { id: `${uid}-${key}`, "aria-invalid": !!errors[key] || undefined, "aria-describedby": errors[key] ? `${uid}-${key}-error` : undefined, style: errors[key] ? { borderColor: "var(--danger)" } : undefined }; }
  function error(key: string) { return errors[key] && <p id={`${uid}-${key}-error`} role="alert" className="mt-1 text-xs text-[var(--danger)]">{errors[key]}</p>; }
  function field(key: string, label: string, child: ReactNode) { return <div data-crm-field={key}><label htmlFor={`${uid}-${key}`} className="tf-label mb-1.5 block">{label}</label>{child}{error(key)}</div>; }
  function date(key: "wonAt" | "dueDate", label: string) { return <div data-crm-field={key}><DeadlineField dateOnly required id={`${uid}-${key}`} label={label} maxDate={key === "wonAt" ? todayKey : undefined} value={state[key]} onChange={value => set(key, value)} invalid={!!errors[key]} describedBy={errors[key] ? `${uid}-${key}-error` : undefined} />{error(key)}</div>; }
  function showErrors(next: Record<string, string>) { setErrors(next); requestAnimationFrame(() => focusCrmError(root.current, next, ["outcome", "contractValue", "wonAt", "projectName", "reasonId", "note", "lessons", "followUp", "assigneeId", "dueDate"])); }
  function submit() {
    if (pending || submitting.current) return;
    const next = validateOutcomeForm(state, reasons, todayKey);
    if (state.outcome && !choices.includes(state.outcome)) next.outcome = "Chọn kết quả.";
    if (state.followUp && !won && !users.some(u => u.id === state.assigneeId)) next.assigneeId = "Chọn người làm đang hoạt động.";
    if (Object.keys(next).length) { showErrors(next); return; }
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = won ? await winOpportunityAction(buildWinPayload(opportunityId, version, state)) : await closeOpportunityAction({ ...buildClosePayload(opportunityId, version, state), winnerCompetitorId: state.outcome === "LOST_COMPETITIVE" && winnerId ? winnerId : null });
        if (result.error) { if (result.fieldErrors) showErrors({ ...errors, ...result.fieldErrors }); notify({ tone: "error", message: result.error }); }
        else if (result.success) { notify({ tone: "success", message: result.success }); onOpenChange(false); router.refresh(); }
      } catch { notify({ tone: "error", message: "Không lưu được. Kiểm tra kết nối rồi thử lại." }); }
      finally { submitting.current = false; }
    });
  }
  return <CrmDialogFrame
    open title={mode === "RESULT" ? "Ghi kết quả" : "Kết thúc Cơ hội"}
    dirty={snapshot !== JSON.stringify(state)} pending={pending}
    onClose={() => onOpenChange(false)} onSubmit={submit}
    submitLabel={won ? "Xác nhận thắng và tạo Project" : "Lưu kết quả"}
    submitDisabled={!state.outcome}
  >
    <div ref={root} className="space-y-4">
      <div data-crm-field="outcome">
        <span id={`${uid}-outcome-label`} className="tf-label">Kết quả</span>
        <div role="radiogroup" aria-labelledby={`${uid}-outcome-label`} aria-invalid={!!errors.outcome || undefined} aria-describedby={errors.outcome ? `${uid}-outcome-error` : undefined} className="mt-2 grid grid-cols-2 gap-2">
          {choices.map(choice => <label key={choice} className={`cursor-pointer rounded-[10px] border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-zinc-400 ${state.outcome === choice ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600"}`}>
            <input type="radio" className="sr-only" name={`${uid}-outcome`} checked={state.outcome === choice} onChange={() => { setState(s => ({ ...s, outcome: choice, reasonId: "", note: "", lessons: "", followUp: false })); setErrors({}); }} />
            {OPPORTUNITY_OUTCOMES.find(o => o.key === choice)?.label}
          </label>)}
        </div>
        {error("outcome")}
      </div>
      {won ? <>
        {field("contractValue", "Giá trị hợp đồng (VND)", <>
          {budget && <p className="mb-2 text-xs text-zinc-500">Ngân sách dự kiến: {budget}</p>}
          <input
            {...a("contractValue")}
            required
            inputMode="numeric"
            className="tf-field"
            value={state.contractValue}
            onChange={e => set("contractValue", formatThousandsInput(e.target.value))}
          />
        </>)}
        {date("wonAt", "Ngày thắng")}
        {field("projectName", "Tên Project", <input
          {...a("projectName")}
          required
          maxLength={200}
          className="tf-field"
          value={state.projectName}
          onChange={e => set("projectName", e.target.value)}
        />)}
      </> : state.outcome && <>
        {field("reasonId", state.outcome === "LOST_COMPETITIVE" ? "Lý do thua" : state.outcome === "CUSTOMER_CANCELLED" ? "Lý do hủy" : "Lý do không tham gia", <select
          {...a("reasonId")}
          required
          className="tf-field"
          value={state.reasonId}
          onChange={e => { set("reasonId", e.target.value); setErrors({}); }}
        >
          <option value="">Chọn lý do</option>
          {catalog.map(reason => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
        </select>)}
        {field("note", "Ghi chú", <textarea {...a("note")} required={catalog.find(r => r.id === state.reasonId)?.requiresNote} rows={3} maxLength={4000} className="tf-field" value={state.note} onChange={e => set("note", e.target.value)} />)}
        {state.outcome === "LOST_COMPETITIVE" && !!props.competitors?.length && field("winner", "Agency thắng", <select {...a("winner")} className="tf-field" value={winnerId} onChange={e => setWinnerId(e.target.value)}><option value="">Chưa rõ</option>{props.competitors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}
        {state.outcome === "LOST_COMPETITIVE" && field("lessons", "Điều rút ra", <textarea {...a("lessons")} rows={3} maxLength={4000} className="tf-field" value={state.lessons} onChange={e => set("lessons", e.target.value)} />)}
        <button
          type="button"
          role="switch"
          aria-checked={state.followUp}
          className="flex min-h-10 w-full items-center justify-between gap-3 text-left text-sm"
          onClick={() => set("followUp", !state.followUp)}
        >
          {state.outcome === "LOST_COMPETITIVE" ? "Kế hoạch lấy lại" : "Hẹn tiếp cận lại"}
          <span aria-hidden="true" className={`flex h-6 w-10 items-center rounded-full p-1 ${state.followUp ? "justify-end bg-zinc-900" : "bg-zinc-200"}`}><span className="h-4 w-4 rounded-full bg-white" /></span>
        </button>
        {state.followUp && <div data-crm-field="followUp" className="space-y-4">
          {field("followUpTitle", "Việc cần làm", <input
            {...a("followUpTitle")}
            aria-invalid={!!(errors.followUpTitle || errors.followUp) || undefined}
            aria-describedby={errors.followUp ? `${uid}-followUp-error` : a("followUpTitle")["aria-describedby"]}
            style={errors.followUp ? { borderColor: "var(--danger)" } : a("followUpTitle").style}
            required
            maxLength={500}
            className="tf-field"
            value={state.followUpTitle}
            onChange={e => set("followUpTitle", e.target.value)}
          />)}
          {error("followUp")}
          {field("assigneeId", "Người làm", <div {...a("assigneeId")} role="group">
            <UserPicker
              options={users}
              value={state.assigneeId ?? ""}
              onChange={id => set("assigneeId", id || null)}
              ariaLabel="Người làm"
              placeholder="Chọn người làm"
            />
          </div>)}
          {date("dueDate", "Hạn")}
        </div>}
      </>}
      {state.outcome && <div className="space-y-2 pt-2">{outcomeFooterLines(state.outcome, openBidPrepTaskCount, winPreview).map(line => <p key={line} className="text-xs text-zinc-600">{line}</p>)}</div>}
    </div>
  </CrmDialogFrame>;
}
