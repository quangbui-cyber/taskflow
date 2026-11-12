"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeClientCompetitorAction, saveClientCompetitorAction } from "@/app/actions/crmClients";
import { useInteraction } from "@/components/InteractionProvider";
import { useClientEditSession } from "./ClientEditSession";

type Link = { competitorId: string; name: string; active: boolean; note: string | null; since: string | null };
const monthYear = (key: string) => { const [y, m] = key.split("-"); return `${m}/${y}`; };

/** Aside block "Agency đang phục vụ": agencies currently serving this client, from the Admin catalog. */
export default function ClientCompetitors({ clientId, links, options, canEdit }: { clientId: string; links: Link[]; options: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter(); const { notify } = useInteraction();
  const session = useClientEditSession();
  const [actionPending, startTransition] = useTransition();
  const pending = actionPending || !!session?.busy;
  const [draft, setDraft] = useState<{ competitorId: string; note: string; since: string } | null>(null);
  const available = options.filter((option) => !links.some((link) => link.competitorId === option.id));
  function run(action: () => Promise<{ error?: string; success?: string; version?: number }>, done?: () => void) {
    if (pending) return;
    session?.setBusy(true);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) { notify({ message: result.error, tone: "error" }); return; }
        if (result.version !== undefined) session?.saved(result.version);
        notify({ message: result.success ?? "Đã lưu thay đổi.", tone: "success" }); done?.(); router.refresh();
      } catch { notify({ message: "Không lưu được thay đổi. Vui lòng thử lại.", tone: "error" }); }
      finally { session?.setBusy(false); }
    });
  }
  return <div className="space-y-3">
    {links.length ? <ul className="space-y-2.5">{links.map((link) => <li key={link.competitorId} className="flex items-start justify-between gap-2 text-[13px]">
      <div className="min-w-0"><p className={link.active ? "" : "text-zinc-400"}>{link.name}</p>{(link.note || link.since) && <p className="mt-0.5 break-words text-xs text-zinc-500">{[link.since && `Từ ${monthYear(link.since)}`, link.note].filter(Boolean).join(" · ")}</p>}</div>
      {canEdit && <div className="flex shrink-0 gap-2"><button type="button" disabled={pending || !!draft} className="text-zinc-500 hover:text-zinc-900" aria-label={`Sửa ${link.name}`} onClick={() => setDraft({ competitorId: link.competitorId, note: link.note ?? "", since: link.since?.slice(0, 7) ?? "" })}>Sửa</button><button type="button" disabled={pending} className="text-zinc-500 hover:text-zinc-900" aria-label={`Bỏ ${link.name}`} onClick={() => run(() => removeClientCompetitorAction({ clientId, competitorId: link.competitorId }))}>Bỏ</button></div>}
    </li>)}</ul> : <p className="text-[13px] text-zinc-400">Chưa có</p>}
    {canEdit && !draft && (available.length ? <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => setDraft({ competitorId: available[0].id, note: "", since: "" })}>Thêm agency</button> : null)}
    {draft && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); run(() => saveClientCompetitorAction({ clientId, competitorId: draft.competitorId, note: draft.note.trim() || null, since: draft.since ? `${draft.since}-01` : null }), () => setDraft(null)); }}><fieldset disabled={pending} className="min-w-0 space-y-3">
      {links.some((link) => link.competitorId === draft.competitorId) ? <p className="text-sm font-semibold">{links.find((link) => link.competitorId === draft.competitorId)?.name}</p>
        : <label className="block text-sm">Agency<select className="tf-field mt-2" value={draft.competitorId} onChange={(event) => setDraft({ ...draft, competitorId: event.target.value })}>{available.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
      <label className="block text-sm">Phục vụ từ<input type="month" className="tf-field mt-2" value={draft.since} onChange={(event) => setDraft({ ...draft, since: event.target.value })} /></label>
      <label className="block text-sm">Ghi chú<input className="tf-field mt-2" maxLength={500} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
      <div className="flex justify-end gap-2"><button type="button" className="tf-button-secondary" onClick={() => setDraft(null)}>Hủy</button><button type="submit" className="tf-button-primary">Lưu</button></div>
    </fieldset></form>}
  </div>;
}
