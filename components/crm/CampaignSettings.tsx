"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSuggestedCampaignTemplatesAction, saveCampaignTemplateAction } from "@/app/actions/crmCampaign";
import { saveCrmSettingAction } from "@/app/actions/crmSettings";
import { useInteraction } from "@/components/InteractionProvider";
import { CAMPAIGN_MAX_OFFSET, CAMPAIGN_MAX_STEPS, type CampaignStep } from "@/lib/crm/campaignPlan";
import { TOUCHPOINT_KINDS } from "@/lib/crm/labels";

type Template = { id: string; name: string; description: string | null; steps: CampaignStep[]; active: boolean; order: number };
type Editing = Omit<Template, "id"> & { id?: string };

/** crm52: Admin → CRM. Campaign templates (added only on request) and the weekly load warning, empty until set. */
export default function CampaignSettings({ templates, weeklyLoadWarn, version }: { templates: Template[]; weeklyLoadWarn: number | null; version: number }) {
  const [threshold, setThreshold] = useState(weeklyLoadWarn === null ? "" : String(weeklyLoadWarn));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();
  const router = useRouter();
  const uid = useId();
  const done = (result: { error?: string; success?: string }) => {
    notify({ message: result.error ?? result.success ?? "Đã lưu.", tone: result.error ? "error" : "success" });
    if (!result.error) router.refresh();
    return !result.error;
  };
  function saveThreshold() {
    const value = threshold.trim() === "" ? null : Number(threshold);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 200)) { notify({ message: "Nhập số việc từ 1 đến 200, hoặc để trống.", tone: "error" }); return; }
    startTransition(async () => { done(await saveCrmSettingAction("campaign.weeklyLoadWarn", { perWeek: value }, version)); });
  }
  function saveTemplate() {
    if (!editing) return;
    startTransition(async () => { if (done(await saveCampaignTemplateAction(editing))) setEditing(null); });
  }
  const setStep = (i: number, patch: Partial<CampaignStep>) => editing && setEditing({ ...editing, steps: editing.steps.map((s, x) => x === i ? { ...s, ...patch } : s) });

  return <section className="tf-panel space-y-5 p-5 sm:p-6" aria-labelledby={`${uid}-title`}>
    <h2 id={`${uid}-title`} className="text-base font-semibold text-zinc-900">Chiến dịch chăm sóc</h2>
    <div className="flex flex-wrap items-end gap-3">
      <div><label htmlFor={`${uid}-load`} className="tf-label">Cảnh báo khi một người có hơn (việc/tuần)</label>
        <input id={`${uid}-load`} type="number" min={1} max={200} inputMode="numeric" className="tf-field w-32" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
      <button type="button" className="tf-button-secondary" disabled={pending} onClick={saveThreshold}>Lưu ngưỡng tải</button>
      {weeklyLoadWarn === null && <span className="tf-badge bg-zinc-100 text-zinc-600">Chưa cấu hình</span>}
    </div>
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">Mẫu chiến dịch</h3>
        <div className="flex gap-2">
          <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => startTransition(async () => { done(await addSuggestedCampaignTemplatesAction()); })}>Thêm mẫu gợi ý</button>
          <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => setEditing({ name: "", description: null, steps: [{ offsetDays: 0, title: "", kind: "CALL" }], active: true, order: templates.length })}>+ Mẫu mới</button>
        </div>
      </div>
      {templates.length ? <ul className="divide-y divide-zinc-100 rounded-[14px] border border-zinc-200">
        {templates.map((t) => <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className={`min-w-0 break-words ${t.active ? "" : "text-zinc-400"}`}><b className="font-medium">{t.name}</b><span className="text-xs text-zinc-500"> · {[t.description, `${t.steps.length} bước`, t.active ? null : "đã tắt"].filter(Boolean).join(" · ")}</span></span>
          <button type="button" className="text-xs text-zinc-600 hover:text-zinc-900" onClick={() => setEditing({ ...t })}>Sửa</button>
        </li>)}
      </ul> : <p className="text-sm text-zinc-500">Chưa có mẫu.</p>}
    </div>
    {editing && <div className="space-y-3 rounded-[14px] bg-zinc-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor={`${uid}-tname`} className="tf-label">Tên mẫu</label><input id={`${uid}-tname`} className="tf-field" maxLength={80} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
        <div><label htmlFor={`${uid}-tdesc`} className="tf-label">Mô tả</label><input id={`${uid}-tdesc`} className="tf-field" maxLength={200} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value || null })} /></div>
      </div>
      <ol className="space-y-2">{editing.steps.map((s, i) => <li key={i} className="grid grid-cols-[80px_minmax(0,1fr)_140px_36px] items-center gap-2">
        <label className="flex items-center gap-1 text-sm font-semibold"><span aria-hidden="true">N+</span><span className="sr-only">Số ngày bước {i + 1}</span><input type="number" min={0} max={CAMPAIGN_MAX_OFFSET} className="tf-field w-14" value={s.offsetDays} onChange={(e) => setStep(i, { offsetDays: Math.max(0, Math.min(CAMPAIGN_MAX_OFFSET, Math.trunc(Number(e.target.value)) || 0)) })} /></label>
        <input aria-label={`Nội dung bước ${i + 1}`} className="tf-field" maxLength={200} value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} />
        <select aria-label={`Loại điểm chạm bước ${i + 1}`} className="tf-field" value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as CampaignStep["kind"] })}>{TOUCHPOINT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        <button type="button" className="tf-icon-button" aria-label={`Xóa bước ${i + 1}`} disabled={editing.steps.length === 1} onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, x) => x !== i) })}>×</button>
      </li>)}</ol>
      <div className="flex flex-wrap items-center gap-3">
        {editing.steps.length < CAMPAIGN_MAX_STEPS && <button type="button" className="tf-button-secondary" onClick={() => setEditing({ ...editing, steps: [...editing.steps, { offsetDays: (editing.steps.at(-1)?.offsetDays ?? 0) + 3, title: "", kind: "CALL" }] })}>+ Thêm bước</button>}
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />Đang dùng</label>
        <span className="flex-1" />
        <button type="button" className="tf-button-secondary" onClick={() => setEditing(null)}>Hủy</button>
        <button type="button" className="tf-button-primary" disabled={pending} onClick={saveTemplate}>Lưu mẫu</button>
      </div>
    </div>}
  </section>;
}
