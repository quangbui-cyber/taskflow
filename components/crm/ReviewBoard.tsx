"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { dismissDraftAction } from "@/app/actions/crmTouchpoints";
import { useInteraction } from "@/components/InteractionProvider";
import type { DraftRow, WeeklyReview } from "@/lib/crm/reviewData";
import type { TouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import { formatCrmDate } from "@/lib/crm/dates";
import type { rowActionsFor, reviewTiles } from "@/lib/crm/reviewView";
import ReviewRow from "./ReviewRow";
import TouchpointDialog from "./TouchpointDialog";

type Props = {
  groups: WeeklyReview["groups"]; drafts: DraftRow[]; tiles: ReturnType<typeof reviewTiles>;
  draftsOpen: boolean; actionsByKey: Record<string, ReturnType<typeof rowActionsFor>>;
  dialogOptions: TouchpointDialogOptions; accounts: { id: string; name: string }[]; now: Date;
  emptyState: ReactNode; unrated: ReactNode;
};
const GROUPS = [
  { key: "OVERDUE", id: "crm-group-overdue", title: "Quá hạn", empty: "Không có khách quá hạn." },
  { key: "DUE_THIS_WEEK", id: "crm-group-due", title: "Đến hạn tuần này", empty: "Không có khách đến hạn tuần này." },
  { key: "NO_NEXT_STEP", id: "crm-group-no-next", title: "Chưa có bước tiếp theo", empty: "Khách nào cũng đã có bước tiếp theo." },
] as const;
export default function ReviewBoard({ groups: initialGroups, drafts: initialDrafts, tiles, draftsOpen, actionsByKey, dialogOptions, accounts, now, emptyState, unrated }: Props) {
  // Revalidation must not remove the final row or change its actions during a meeting.
  const [groups] = useState(() => initialGroups);
  const [drafts] = useState(() => initialDrafts);
  const [actions] = useState(() => actionsByKey);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (details.current) details.current.open = draftsOpen; }, [draftsOpen]);
  const empty = Object.values(groups).every(rows => rows.length === 0) && drafts.length === 0;
  return <>
    {empty ? emptyState : <div className="space-y-6">{GROUPS.map(g => <section key={g.key} id={g.id} aria-label={g.title} className="tf-panel scroll-mt-4 overflow-hidden">
      <header className="flex items-center gap-2 px-5 py-3"><h2 className="text-base font-semibold">{g.title}</h2><span className="text-xs tabular-nums text-zinc-500">{groups[g.key].length}</span></header>
      <div className="divide-y divide-zinc-100">{groups[g.key].length ? groups[g.key].map(row => <ReviewRow key={row.key} row={row} actions={actions[row.key]} dialogOptions={dialogOptions} accounts={accounts} now={now} />) : <p className="px-5 py-4 text-sm text-zinc-500">{g.empty}</p>}</div>
    </section>)}</div>}
    {unrated}
    {!empty && <details ref={details} id="crm-drafts" className="tf-panel !mt-12 scroll-mt-4">
      <summary className="cursor-pointer px-5 py-3 text-base font-semibold">Điểm chạm nháp <span className="ml-2 text-xs font-normal text-zinc-500">{tiles.find(t => t.anchor === "crm-drafts")?.count ?? drafts.length}</span></summary>
      <div className="divide-y divide-zinc-100">{drafts.map(draft => <ReviewDraft key={draft.id} draft={draft} options={dialogOptions} now={now} />)}</div>
    </details>}
  </>;
}
function ReviewDraft({ draft, options, now }: { draft: DraftRow; options: TouchpointDialogOptions; now: Date }) {
  const { notify } = useInteraction();
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  if (removed) return null;
  function dismiss() {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await dismissDraftAction(draft.id);
        if ("error" in result) notify({ tone: "error", message: result.error });
        else { notify({ tone: "success", message: result.success }); setRemoved(true); }
      } catch { notify({ tone: "error", message: "Không lưu được. Kiểm tra kết nối rồi thử lại." }); }
      finally { busy.current = false; }
    });
  }
  return <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4" aria-busy={pending}>
    <div className="min-w-0 space-y-1"><p className="text-xs text-zinc-500">{formatCrmDate(draft.occurredAt, now)} · {draft.sourceLabel}</p><p className="break-words text-sm">{draft.title}</p><p className="text-xs text-zinc-500">{draft.clientName}</p></div>
    {draft.canConfirm && <div className="flex gap-2"><button type="button" className="tf-button-secondary min-h-10 md:!min-h-9" disabled={pending} onClick={() => setOpen(true)}>Xác nhận</button><button type="button" className="tf-button-secondary min-h-10 md:!min-h-9" disabled={pending} aria-busy={pending} onClick={dismiss}>{pending && <span className="tf-spinner" />}Bỏ qua</button></div>}
    <TouchpointDialog options={options} triggerVariant="secondary" lockClient renderTrigger={false} open={open} onOpenChange={setOpen} prefill={{ clientId: draft.clientId, opportunityId: draft.opportunityId, confirmDraftId: draft.id, occurredAt: draft.occurredAt.toISOString(), kind: "MEETING" }} onSaved={() => setRemoved(true)} />
  </div>;
}
