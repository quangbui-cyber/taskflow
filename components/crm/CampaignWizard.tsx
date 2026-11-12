"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCampaignDraftAction, launchCampaignAction, previewCampaignAction, saveCampaignDraftAction } from "@/app/actions/crmCampaign";
import { useInteraction } from "@/components/InteractionProvider";
import type { CampaignWizardOptions } from "@/lib/crm/campaignData";
import { CAMPAIGN_MAX_OFFSET, CAMPAIGN_MAX_STEPS, DEFAULT_CAMPAIGN_OPTIONS, EMPTY_CAMPAIGN_FILTER, EXCLUDE_REASON_LABELS, type CampaignDraft, type CampaignFilter, type CampaignOptions, type CampaignStep } from "@/lib/crm/campaignPlan";
import { CLIENT_LIFECYCLE_LABELS } from "@/lib/crm/clientLifecycle";
import { TIER_LABELS, TOUCHPOINT_KINDS } from "@/lib/crm/labels";
import type { TierValue } from "@/lib/crm/settingsSchema";

type Preview = Extract<Awaited<ReturnType<typeof previewCampaignAction>>, { preview: unknown }>["preview"];
const STEPS = ["Mục tiêu và mẫu", "Chọn khách", "Các bước chăm sóc", "Phân công và tải", "Xem trước và chạy"] as const;
const TIERS: TierValue[] = ["S", "A", "B", "C", "UNRATED"];
const LIFECYCLES = ["PROSPECT", "ACTIVE", "DORMANT"] as const;
const OPTION_LABELS: Record<keyof CampaignOptions, string> = { stopOnOpportunity: "Dừng các bước còn lại khi khách mở Cơ hội", skipBidding: "Bỏ qua khách đang Bidding", pauseCadence: "Tạm dừng nhắc chu kỳ trong lúc chạy" };
const ddmm = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const weekLabel = (key: string) => `T${Number(key.slice(6))}`;
const kindLabel = (kind: string) => TOUCHPOINT_KINDS.find((k) => k.key === kind)?.label ?? kind;
const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[13px] transition-colors duration-150 ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"}`}>{children}</button>;
}
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return <div role="group" aria-label={label} className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-start"><span className="pt-1.5 text-xs font-medium text-zinc-500">{label}</span><div className="flex flex-wrap gap-1.5">{children}</div></div>;
}

/** crm52 (sketch 006 screen 7): five steps, saved as a draft on every step change; launch creates CRM tasks, never emails. */
export default function CampaignWizard({ options, todayKey, initial, initialStep = 0 }: { options: CampaignWizardOptions; todayKey: string; initial: { id: string; version: number; draft: CampaignDraft } | null; initialStep?: number }) {
  const [draft, setDraft] = useState<CampaignDraft>(() => initial?.draft ?? { name: "", goal: null, targetOpportunities: null, startKey: todayKey, endKey: null, steps: [], options: DEFAULT_CAMPAIGN_OPTIONS, filter: EMPTY_CAMPAIGN_FILTER, assignments: {}, teamId: options.isAdmin ? null : options.ownerTeams[0]?.id ?? null });
  const [saved, setSaved] = useState<{ id: string | null; version: number }>({ id: initial?.id ?? null, version: initial?.version ?? 0 });
  const [step] = useState(initialStep);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [addName, setAddName] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { notify } = useInteraction();
  const uid = useId();
  const top = useRef<HTMLDivElement>(null);
  const clientNames = useMemo(() => new Map(options.clients.map((c) => [c.id, c.name])), [options.clients]);
  const set = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setFilter = (patch: Partial<CampaignFilter>) => setDraft((d) => ({ ...d, filter: { ...d.filter, ...patch } }));

  // Server preview (selection, schedule, weekly load) whenever the draft changes on steps 2-5; debounced, last answer wins.
  useEffect(() => {
    if (step === 0 || !draft.name.trim()) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await previewCampaignAction(draft);
        if (!live) return;
        if ("preview" in result && result.preview) { setPreview(result.preview); setPreviewError(null); } else setPreviewError(("error" in result && result.error) || "Không xem trước được.");
      } catch { if (live) setPreviewError("Không xem trước được. Thử lại sau."); }
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [draft, step]);

  function persist(next: (id: string) => void) {
    startTransition(async () => {
      const result = await saveCampaignDraftAction({ id: saved.id, expectedVersion: saved.id ? saved.version : undefined, draft });
      if ("error" in result) { notify({ message: result.error ?? "Không lưu được bản nháp.", tone: "error" }); return; }
      setSaved({ id: result.id ?? saved.id, version: result.version ?? saved.version });
      setSavedAt(new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }));
      if (result.id) next(result.id);
    });
  }
  function goto(target: number) {
    if (target > 0 && !draft.name.trim()) { notify({ message: "Nhập tên chiến dịch.", tone: "error" }); return; }
    // A save revalidates this route. Keep the destination in the URL so a refreshed wizard resumes the right step.
    persist((id) => { router.replace(`/crm/campaigns/${id}?step=${target + 1}`, { scroll: false }); requestAnimationFrame(() => top.current?.scrollIntoView({ block: "start", behavior: "smooth" })); });
  }
  function launch() {
    if (!saved.id) return;
    startTransition(async () => {
      const save = await saveCampaignDraftAction({ id: saved.id, expectedVersion: saved.version, draft });
      if ("error" in save) { notify({ message: save.error ?? "Không lưu được bản nháp.", tone: "error" }); return; }
      const result = await launchCampaignAction({ id: saved.id, expectedVersion: save.version });
      if ("error" in result) { setSaved({ id: saved.id, version: save.version ?? saved.version }); notify({ message: result.error ?? "Không chạy được chiến dịch.", tone: "error" }); return; }
      notify({ message: result.success ?? "Đã chạy chiến dịch.", tone: "success" });
      router.replace(`/crm/campaigns/${saved.id}`);
      router.refresh();
    });
  }
  function discard() {
    if (!saved.id) { router.push("/crm/campaigns"); return; }
    if (!window.confirm("Xóa bản nháp này?")) return;
    startTransition(async () => {
      const result = await deleteCampaignDraftAction({ id: saved.id, expectedVersion: saved.version });
      if ("error" in result) { notify({ message: result.error ?? "Không xóa được.", tone: "error" }); return; }
      router.push("/crm/campaigns");
    });
  }

  const selection = preview?.selection;
  const pics = preview?.pics ?? [];
  const picName = (userId: string) => selection?.targets.find((t) => t.picUserId === userId)?.picName ?? pics.find((p) => p.userId === userId)?.name ?? "PIC";
  const clientsOf = (userId: string) => selection?.targets.filter((t) => t.picUserId === userId).length ?? 0;
  const addByName = (value: string) => {
    const match = options.clients.find((c) => c.name === value.trim());
    if (!match) return;
    setFilter({ include: [...new Set([...draft.filter.include, match.id])], exclude: draft.filter.exclude.filter((id) => id !== match.id) });
    setAddName("");
  };
  const removeClient = (id: string) => setFilter({ exclude: [...new Set([...draft.filter.exclude, id])], include: draft.filter.include.filter((x) => x !== id) });
  const assign = (clientId: string, accountId: string) => set("assignments", { ...draft.assignments, [clientId]: accountId });
  const setStepRow = (index: number, patch: Partial<CampaignStep>) => set("steps", draft.steps.map((s, i) => i === index ? { ...s, ...patch } : s));
  const lastKey = preview?.scheduled.reduce((max, s) => s.dueKey > max ? s.dueKey : max, draft.startKey) ?? draft.startKey;
  const busy = pending ? <span className="tf-spinner" aria-hidden="true" /> : null;

  return <div ref={top} className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="tf-page-title">{draft.name.trim() || "Chiến dịch mới"}</h1><p className="tf-page-subtitle">Bản nháp{savedAt ? ` · đã lưu ${savedAt}` : ""}</p></div>
      <button type="button" className="tf-button-secondary" onClick={discard} disabled={pending}>{saved.id ? "Xóa bản nháp" : "Hủy"}</button>
    </header>
    <section className="tf-panel overflow-hidden">
      <ol className="flex overflow-x-auto border-b border-zinc-100 text-[13px]" aria-label="Các bước tạo chiến dịch">
        {STEPS.map((label, i) => <li key={label} className="shrink-0">
          <button type="button" disabled={pending || i === step} onClick={() => goto(i)} aria-current={i === step ? "step" : undefined}
            className={`flex min-h-11 items-center gap-1.5 border-b-2 px-4 transition-colors duration-150 ${i === step ? "border-brand-500 font-semibold text-zinc-900" : i < step ? "border-transparent text-brand-700 hover:text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>
            {i < step ? "✓ " : ""}{i + 1} {label}{i === 1 && selection ? ` · ${selection.targets.length}` : ""}
          </button>
        </li>)}
      </ol>
      <div className="grid gap-5 p-5 sm:p-6">
        {step === 0 && <>
          {!!options.templates.length && <div role="group" aria-label="Mẫu chiến dịch" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {options.templates.map((t) => {
              const on = JSON.stringify(t.steps) === JSON.stringify(draft.steps);
              return <button key={t.id} type="button" aria-pressed={on} onClick={() => setDraft((d) => ({ ...d, steps: t.steps, name: d.name.trim() ? d.name : `${t.name} ${todayKey.slice(0, 4)}` }))}
                className={`grid gap-1 rounded-[14px] border p-3.5 text-left transition duration-150 hover:-translate-y-0.5 ${on ? "border-brand-500 bg-brand-50" : "border-zinc-200 bg-white"}`}>
                <span className="font-semibold text-zinc-900">{t.name}</span><span className="text-xs text-zinc-500">{[t.description, `${t.steps.length} bước`].filter(Boolean).join(" · ")}</span>
              </button>;
            })}
          </div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><label htmlFor={`${uid}-name`} className="tf-label">Tên chiến dịch</label><input id={`${uid}-name`} className="tf-field" maxLength={120} value={draft.name} onChange={(e) => set("name", e.target.value)} /></div>
            <div><label htmlFor={`${uid}-goal`} className="tf-label">Mục tiêu</label><input id={`${uid}-goal`} className="tf-field" maxLength={500} value={draft.goal ?? ""} onChange={(e) => set("goal", e.target.value || null)} /></div>
            <div><label htmlFor={`${uid}-target`} className="tf-label">Số Cơ hội muốn mở</label><input id={`${uid}-target`} type="number" min={0} max={500} inputMode="numeric" className="tf-field" value={draft.targetOpportunities ?? ""} onChange={(e) => set("targetOpportunities", e.target.value === "" ? null : Math.max(0, Math.min(500, Math.trunc(Number(e.target.value)) || 0)))} /></div>
            <div><label htmlFor={`${uid}-team`} className="tf-label">Team</label>
              <select id={`${uid}-team`} className="tf-field" value={draft.teamId ?? ""} onChange={(e) => set("teamId", e.target.value || null)}>
                {options.isAdmin && <option value="">Toàn công ty</option>}
                {options.ownerTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor={`${uid}-start`} className="tf-label">Bắt đầu</label><input id={`${uid}-start`} type="date" min={todayKey} className="tf-field" value={draft.startKey} onChange={(e) => e.target.value && set("startKey", e.target.value)} /></div>
              <div><label htmlFor={`${uid}-end`} className="tf-label">Kết thúc</label><input id={`${uid}-end`} type="date" min={draft.startKey} className="tf-field" value={draft.endKey ?? ""} onChange={(e) => set("endKey", e.target.value || null)} /></div>
            </div>
          </div>
        </>}

        {step === 1 && <>
          <div className="grid gap-3">
            <Group label="Hạng">{TIERS.map((t) => <Chip key={t} on={draft.filter.tiers.includes(t)} onClick={() => setFilter({ tiers: toggle(draft.filter.tiers, t) })}>{TIER_LABELS[t]}</Chip>)}</Group>
            <Group label="Vòng đời">{LIFECYCLES.map((l) => <Chip key={l} on={draft.filter.lifecycles.includes(l)} onClick={() => setFilter({ lifecycles: toggle(draft.filter.lifecycles, l) })}>{CLIENT_LIFECYCLE_LABELS[l]}</Chip>)}</Group>
            <Group label="Tháng mùa vụ">{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <Chip key={m} on={draft.filter.seasonMonths.includes(m)} onClick={() => setFilter({ seasonMonths: toggle(draft.filter.seasonMonths, m) })}>T{m}</Chip>)}</Group>
            {!!options.tags.length && <Group label="Nhãn">{options.tags.map((t) => <Chip key={t.id} on={draft.filter.tagIds.includes(t.id)} onClick={() => setFilter({ tagIds: toggle(draft.filter.tagIds, t.id) })}>{t.label}</Chip>)}</Group>}
            {!!options.industries.length && <Group label="Ngành">{options.industries.map((i) => <Chip key={i} on={draft.filter.industries.includes(i)} onClick={() => setFilter({ industries: toggle(draft.filter.industries, i) })}>{i}</Chip>)}</Group>}
            {!draft.teamId && <Group label="Team">{options.teams.map((t) => <Chip key={t.id} on={draft.filter.teamIds.includes(t.id)} onClick={() => setFilter({ teamIds: toggle(draft.filter.teamIds, t.id) })}>{t.name}</Chip>)}</Group>}
            <Group label="PIC">{options.pics.filter((p) => !draft.teamId || p.teamId === draft.teamId).map((p) => <Chip key={p.accountId} on={draft.filter.picAccountIds.includes(p.accountId)} onClick={() => setFilter({ picAccountIds: toggle(draft.filter.picAccountIds, p.accountId) })}>{p.name}</Chip>)}</Group>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 sm:max-w-sm"><label htmlFor={`${uid}-add`} className="tf-label">Thêm khách</label>
              <input id={`${uid}-add`} list={`${uid}-clients`} className="tf-field" value={addName} onChange={(e) => { setAddName(e.target.value); if (clientNames.size && options.clients.some((c) => c.name === e.target.value)) addByName(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addByName(addName); } }} />
              <datalist id={`${uid}-clients`}>{options.clients.map((c) => <option key={c.id} value={c.name} />)}</datalist></div>
            {selection && <p className="pb-2 text-sm text-zinc-500" aria-live="polite">{selection.matched} khách khớp · bỏ chọn {selection.removed} · thêm tay {selection.added} → <b className="text-zinc-900">{selection.targets.length} khách</b></p>}
          </div>
          {previewError && <p role="alert" className="text-sm text-[var(--danger)]">{previewError}</p>}
          {selection?.overLimit && <p role="alert" className="text-sm text-[#b86a08]">Mỗi chiến dịch tối đa 200 khách. Thu hẹp bộ lọc.</p>}
          {selection && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto rounded-[14px] border border-zinc-200" aria-label="Khách trong chiến dịch">
              {selection.targets.map((t) => <li key={t.clientId} className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm"><span className="min-w-0 break-words">{t.name}<span className="text-xs text-zinc-500"> · {t.picName}</span></span><button type="button" className="text-xs text-zinc-500 hover:text-zinc-900" onClick={() => removeClient(t.clientId)} aria-label={`Bỏ ${t.name}`}>Bỏ</button></li>)}
              {!selection.targets.length && <li className="px-3.5 py-6 text-center text-sm text-zinc-500">Chọn bộ lọc hoặc thêm khách.</li>}
            </ul>
            {(!!selection.excluded.length || !!draft.filter.exclude.length) && <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto rounded-[14px] border border-dashed border-zinc-200 text-sm" aria-label="Khách không đưa vào">
              {selection.excluded.map((x) => <li key={x.clientId} className="flex items-center justify-between gap-3 px-3.5 py-2 text-zinc-500"><span className="min-w-0 break-words">{x.name}</span><span className="shrink-0 text-xs">{EXCLUDE_REASON_LABELS[x.reason]}</span></li>)}
              {draft.filter.exclude.map((id) => <li key={id} className="flex items-center justify-between gap-3 px-3.5 py-2 text-zinc-500"><span className="min-w-0 break-words line-through">{clientNames.get(id) ?? "Khách"}</span><button type="button" className="shrink-0 text-xs text-zinc-600 hover:text-zinc-900" onClick={() => setFilter({ exclude: draft.filter.exclude.filter((x) => x !== id) })}>Thêm lại</button></li>)}
            </ul>}
          </div>}
        </>}

        {step === 2 && <>
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="text-xs text-zinc-500"><th className="w-24 pb-2 font-medium">Ngày</th><th className="pb-2 font-medium">Bước</th><th className="w-40 pb-2 font-medium">Loại điểm chạm</th><th className="w-16 pb-2 font-medium">Ai làm</th><th className="w-10" /></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {draft.steps.map((s, i) => <tr key={i}>
                <td className="py-2 pr-2"><label className="flex items-center gap-1 font-semibold"><span aria-hidden="true">N+</span><span className="sr-only">Số ngày sau ngày bắt đầu, bước {i + 1}</span><input type="number" min={0} max={CAMPAIGN_MAX_OFFSET} inputMode="numeric" className="tf-field w-16" value={s.offsetDays} onChange={(e) => setStepRow(i, { offsetDays: Math.max(0, Math.min(CAMPAIGN_MAX_OFFSET, Math.trunc(Number(e.target.value)) || 0)) })} /></label></td>
                <td className="py-2 pr-2"><input aria-label={`Nội dung bước ${i + 1}`} className="tf-field" maxLength={200} value={s.title} onChange={(e) => setStepRow(i, { title: e.target.value })} /></td>
                <td className="py-2 pr-2"><select aria-label={`Loại điểm chạm bước ${i + 1}`} className="tf-field" value={s.kind} onChange={(e) => setStepRow(i, { kind: e.target.value as CampaignStep["kind"] })}>{TOUCHPOINT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></td>
                <td className="py-2 pr-2 text-zinc-600">PIC</td>
                <td className="py-2 text-right"><button type="button" className="tf-icon-button" aria-label={`Xóa bước ${i + 1}`} onClick={() => set("steps", draft.steps.filter((_, x) => x !== i))}>×</button></td>
              </tr>)}
            </tbody>
          </table></div>
          {draft.steps.length < CAMPAIGN_MAX_STEPS && <button type="button" className="tf-button-secondary justify-self-start" onClick={() => set("steps", [...draft.steps, { offsetDays: draft.steps.length ? draft.steps[draft.steps.length - 1].offsetDays + 3 : 0, title: "", kind: "CALL" }])}>+ Thêm bước</button>}
          <fieldset className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><legend className="sr-only">Tùy chọn</legend>
            {(Object.keys(OPTION_LABELS) as (keyof CampaignOptions)[]).map((key) => <label key={key} className="inline-flex items-center gap-2"><input type="checkbox" checked={draft.options[key]} onChange={(e) => set("options", { ...draft.options, [key]: e.target.checked })} />{OPTION_LABELS[key]}</label>)}
          </fieldset>
        </>}

        {step === 3 && preview && <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <caption className="pb-2 text-left text-[13px] font-semibold text-zinc-900">Việc theo PIC và tuần, gồm việc đang có{preview.threshold !== null ? ` · ngưỡng ${preview.threshold}/tuần` : ""}</caption>
              <thead><tr className="text-xs text-zinc-500"><th className="pb-1.5 text-left font-medium">PIC</th>{preview.load.weeks.map((w) => <th key={w} className="pb-1.5 font-medium">{weekLabel(w)}</th>)}</tr></thead>
              <tbody>{preview.load.rows.map((r) => <tr key={r.userId}>
                <th scope="row" className="whitespace-nowrap py-1 pr-3 text-left font-normal">{picName(r.userId)} · {clientsOf(r.userId)} khách</th>
                {r.cells.map((c) => <td key={c.week} className="p-0.5"><span title={`${c.existing} việc đang có + ${c.planned} việc chiến dịch`} className={`grid h-7 place-items-center rounded-[7px] tabular-nums ${c.over ? "bg-[#fff1e0] font-semibold text-[#b86a08] ring-1 ring-[#fdba74]" : c.total ? "bg-brand-50 text-brand-800" : "bg-zinc-50 text-zinc-400"}`}>{c.total}</span></td>)}
              </tr>)}</tbody>
            </table>
          </div>
          {!!preview.suggestions.length && <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Gợi ý giảm tải">
            {preview.load.warnings.map((w) => <span key={`${w.userId}${w.week}`} className="text-[#b86a08]">{picName(w.userId)} tuần {weekLabel(w.week).slice(1)} có {w.total} việc.</span>)}
            {preview.suggestions.map((s, i) => s.kind === "MOVE"
              ? <button key={i} type="button" className="tf-button-secondary" onClick={() => set("assignments", { ...draft.assignments, ...Object.fromEntries(s.clientIds.map((id) => [id, s.toAccountId])) })}>Chuyển {s.clientIds.length} khách cho {s.toName}</button>
              : <button key={i} type="button" className="tf-button-secondary" onClick={() => setStepRow(s.stepIndex, { offsetDays: draft.steps[s.stepIndex].offsetDays + s.addDays })}>Giãn bước {s.stepIndex + 1} thêm {s.addDays} ngày</button>)}
          </div>}
          <div className="grid gap-2">
            <h2 className="text-[13px] font-semibold text-zinc-900">Phân công</h2>
            <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto rounded-[14px] border border-zinc-200">
              {[...preview.selection.targets.map((t) => ({ clientId: t.clientId, name: t.name, accountId: t.picAccountId, note: null as string | null })),
                ...preview.selection.excluded.filter((x) => x.reason === "PIC_NOT_ALLOWED" || x.reason === "NO_PIC").map((x) => ({ clientId: x.clientId, name: x.name, accountId: "", note: EXCLUDE_REASON_LABELS[x.reason] }))]
                .map((row) => <li key={row.clientId} className="grid items-center gap-2 px-3.5 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_220px]">
                  <span className="min-w-0 break-words">{row.name}{row.note && <span className="text-xs text-[#b86a08]"> · {row.note}</span>}</span>
                  <select aria-label={`PIC cho ${row.name}`} className="tf-field" value={row.accountId} onChange={(e) => e.target.value && assign(row.clientId, e.target.value)}>
                    {!row.accountId && <option value="">Chọn PIC</option>}
                    {pics.map((p) => <option key={p.accountId} value={p.accountId}>{p.name}</option>)}
                  </select>
                </li>)}
            </ul>
          </div>
        </>}

        {step === 4 && preview && <>
          <dl className="grid gap-3 sm:grid-cols-4">
            {[["Khách", preview.selection.targets.length], ["Việc sẽ tạo", preview.taskCount], ["PIC", new Set(preview.selection.targets.map((t) => t.picUserId)).size], ["Thời gian", `${ddmm(draft.startKey)} - ${ddmm(draft.endKey ?? lastKey)}`]].map(([label, value]) =>
              <div key={label} className="rounded-[14px] bg-zinc-50 px-4 py-3"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-zinc-900">{value}</dd></div>)}
          </dl>
          <ol className="divide-y divide-zinc-100 text-sm">
            {preview.scheduled.map((s) => <li key={s.stepIndex} className="grid grid-cols-[70px_60px_minmax(0,1fr)_auto] items-center gap-3 py-2"><b>N+{s.offsetDays}</b><span className="tabular-nums text-zinc-500">{ddmm(s.dueKey)}</span><span className="break-words">{s.title}</span><span className="tf-badge bg-zinc-100 text-zinc-700">{kindLabel(s.kind)}</span></li>)}
          </ol>
          <p className="text-sm text-zinc-600">{Object.entries(OPTION_LABELS).filter(([key]) => draft.options[key as keyof CampaignOptions]).map(([, label]) => label).join(" · ")}</p>
          {!!preview.selection.excluded.length && <details className="text-sm"><summary className="cursor-pointer text-zinc-600">{preview.selection.excluded.length} khách không tạo việc</summary>
            <ul className="mt-2 space-y-1 text-zinc-500">{preview.selection.excluded.map((x) => <li key={x.clientId}>{x.name} · {EXCLUDE_REASON_LABELS[x.reason]}</li>)}</ul></details>}
          {!!preview.blockers.length && <ul role="alert" className="space-y-1 text-sm text-[var(--danger)]">{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        </>}
        {(step === 3 || step === 4) && !preview && <p className="text-sm text-zinc-500">{previewError ?? "Đang tính..."}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
          {step > 0 ? <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => goto(step - 1)}>← {STEPS[step - 1]}</button> : <span />}
          {step < 4
            ? <button type="button" className="tf-button-primary" disabled={pending} onClick={() => goto(step + 1)}>{busy}Tiếp: {STEPS[step + 1]} →</button>
            : <button type="button" className="tf-button-primary" disabled={pending || !preview || !!preview.blockers.length || !saved.id} onClick={launch}>{busy}Chạy chiến dịch</button>}
        </div>
      </div>
    </section>
  </div>;
}
