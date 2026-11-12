"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useInteraction } from "@/components/InteractionProvider";
import { useClientEditSession } from "./ClientEditSession";
import { saveClientPlaybookAction } from "@/app/actions/crmClientHub";
import { PLAYBOOK_FIELD_LABELS, PLAYBOOK_SECTIONS, PLAYBOOK_TEXT_MAX, QUOTES_MAX, VENDOR_STATUSES, type PlaybookField, type PlaybookSection } from "@/lib/crm/clientHubLabels";

export type PlaybookTone = "ok" | "warn" | "late" | "none";
export type PlaybookRow = { field: PlaybookField; value: string | null; tag?: { text: string; tone: PlaybookTone } | null; href?: string | null };
export type PlaybookSectionView = { key: PlaybookSection; empty: boolean; updatedLabel: string | null; rows: PlaybookRow[]; values: Record<string, string> };
const TAG_TONES: Record<PlaybookTone, string> = { ok: "bg-brand-50 text-brand-700", warn: "bg-[#fff7e6] text-[#b86a08]", late: "bg-[#fff1ec] text-[#c2410c]", none: "bg-zinc-100 text-zinc-500" };
const LONG_TEXT = new Set<PlaybookField>(["paymentPractice", "invoiceNotes", "brandDos", "brandDonts", "executionNotes", "paymentTermsText"]);

function Field({ field, value, onChange }: { field: PlaybookField; value: string; onChange: (value: string) => void }) {
  const label = PLAYBOOK_FIELD_LABELS[field];
  if (field === "vendorStatus") return <label className="block text-sm">{label}<select className="tf-field mt-2" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Chưa ghi</option>{VENDOR_STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}</select></label>;
  if (field === "vendorRegisteredUntil" || field === "frameworkContractUntil") return <label className="block text-sm">{label}<input type="date" className="tf-field mt-2" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
  if (field === "quotesRequired") return <label className="block text-sm">{label}<input type="number" inputMode="numeric" min={1} max={QUOTES_MAX} className="tf-field mt-2" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
  if (LONG_TEXT.has(field)) return <label className="block text-sm">{label}<textarea className="tf-field mt-2 min-h-20" maxLength={PLAYBOOK_TEXT_MAX} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
  return <label className="block text-sm">{label}<input className="tf-field mt-2" maxLength={field === "brandGuidelineUrl" ? 200 : PLAYBOOK_TEXT_MAX} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SectionCard({ clientId, section, canEdit, version }: { clientId: string; section: PlaybookSectionView; canEdit: boolean; version: number }) {
  const router = useRouter(); const { notify } = useInteraction();
  const session = useClientEditSession();
  const [actionPending, startTransition] = useTransition();
  const pending = actionPending || !!session?.busy;
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const meta = PLAYBOOK_SECTIONS[section.key];
  const titleId = `playbook-${section.key.toLowerCase()}`;
  function save() {
    if (!draft || pending) return;
    const fields: Record<string, string | number | null> = {};
    for (const field of meta.fields) {
      const value = (draft[field] ?? "").trim();
      fields[field] = field === "quotesRequired" ? (value ? Number(value) : null) : value || null;
    }
    session?.setBusy(true);
    startTransition(async () => {
      try {
        const result = await saveClientPlaybookAction({ clientId, expectedVersion: Math.max(version, session?.version ?? 0), section: section.key, fields });
        if ("error" in result && result.error) { notify({ message: result.error, tone: "error" }); return; }
        if ("version" in result && typeof result.version === "number") session?.saved(result.version);
        notify({ message: ("success" in result && result.success) || "Đã lưu sổ tay.", tone: "success" }); setDraft(null); router.refresh();
      } catch { notify({ message: "Không lưu được thay đổi. Vui lòng thử lại.", tone: "error" }); }
      finally { session?.setBusy(false); }
    });
  }
  return <section aria-labelledby={titleId} data-playbook={section.key} data-empty={section.empty ? "true" : "false"} className={`flex min-w-0 flex-col gap-2.5 rounded-[14px] border px-4 py-3.5 ${section.empty && !draft ? "border-[#fed7aa] bg-[#fffaf5]" : "border-zinc-200 bg-white"}`}>
    <header className="flex items-start justify-between gap-2">
      <h3 id={titleId} className="text-[13px] font-semibold">{meta.label}</h3>
      {canEdit && !draft && !section.empty && <button type="button" className="text-xs text-zinc-500 hover:text-zinc-900" disabled={pending} aria-label={`Sửa ${meta.label}`} onClick={() => setDraft({ ...section.values })}>Sửa</button>}
    </header>
    {draft ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }}><fieldset disabled={pending} className="min-w-0 space-y-3">
      {meta.fields.map((field) => <Field key={field} field={field} value={draft[field] ?? ""} onChange={(value) => setDraft({ ...draft, [field]: value })} />)}
      <div className="flex justify-end gap-2"><button type="button" className="tf-button-secondary" onClick={() => setDraft(null)}>Hủy</button><button type="submit" className="tf-button-primary">Lưu</button></div>
    </fieldset></form> : section.empty ? <>
      <p className="text-[13px] text-zinc-500">Chưa có</p>
      {canEdit && <button type="button" className="tf-button-secondary self-start" disabled={pending} aria-label={`Bổ sung ${meta.label}`} onClick={() => setDraft({ ...section.values })}>Bổ sung</button>}
    </> : <dl className="grid gap-1.5 text-[13px]">
      {section.rows.filter((row) => row.value || row.tag).map((row) => <div key={row.field} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <dt className="text-zinc-500">{PLAYBOOK_FIELD_LABELS[row.field]}</dt>
        <dd className="min-w-0 break-words text-right">
          {row.href ? <a href={row.href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">Mở</a> : <span className="whitespace-pre-wrap">{row.value}</span>}
          {row.tag && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${TAG_TONES[row.tag.tone]}`}>{row.tag.text}</span>}
        </dd>
      </div>)}
    </dl>}
    {section.updatedLabel && !draft && <p className="mt-auto text-[11px] text-zinc-400">{section.updatedLabel}</p>}
  </section>;
}

export default function ClientPlaybook({ clientId, version, canEdit, sections }: { clientId: string; version: number; canEdit: boolean; sections: PlaybookSectionView[] }) {
  return <div className="grid gap-3 md:grid-cols-2">{sections.map((section) => <SectionCard key={section.key} clientId={clientId} section={section} canEdit={canEdit} version={version} />)}</div>;
}
