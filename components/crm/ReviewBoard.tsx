"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { dismissDraftAction } from "@/app/actions/crmTouchpoints";
import { useInteraction } from "@/components/InteractionProvider";
import type { DraftRow, UpcomingEventRow, WeeklyReview } from "@/lib/crm/reviewData";
import type { TouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import { formatCrmDate } from "@/lib/crm/dates";
import type { TierValue } from "@/lib/crm/settingsSchema";
import { reviewLanes, reviewWeekProgress, type ReviewRowActions, type WeekSegmentKey } from "@/lib/crm/reviewView";
import ReviewRow from "./ReviewRow";
import TouchpointDialog from "./TouchpointDialog";

type Props = {
  groups: WeeklyReview["groups"]; drafts: DraftRow[]; doneThisWeek: number; upcomingEvents: UpcomingEventRow[];
  draftsOpen: boolean; actionsByKey: Record<string, ReviewRowActions>;
  dialogOptions: TouchpointDialogOptions; accounts: { id: string; name: string }[]; now: Date;
  cadenceWeeks: Record<TierValue, number>; showPic: boolean; unratedCount: number; dataToolHref: string | null;
  emptyState: ReactNode; unrated: ReactNode;
};
const WEEK_PREVIEW = 6, NO_NEXT_PREVIEW = 5;
const SEGMENT_COLORS: Record<WeekSegmentKey, string> = { late: "bg-[#c2410c]", today: "bg-[#f59e0b]", rest: "bg-zinc-300", done: "bg-[#15803d]" };
/** crm51 (sketch 006 screen 1): one week bar, two lanes, and a right column for follow-up and data hygiene. */
export default function ReviewBoard({ groups: initialGroups, drafts: initialDrafts, doneThisWeek, upcomingEvents, draftsOpen, actionsByKey, dialogOptions, accounts, now, cadenceWeeks, showPic, unratedCount, dataToolHref, emptyState, unrated }: Props) {
  // Revalidation must not remove the final row or change its actions during a meeting.
  const [groups] = useState(() => initialGroups);
  const [drafts] = useState(() => initialDrafts);
  const [actions] = useState(() => actionsByKey);
  const [allWeek, setAllWeek] = useState(false);
  const [allNoNext, setAllNoNext] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (details.current && draftsOpen) details.current.open = true; }, [draftsOpen]);
  const empty = Object.values(groups).every(rows => rows.length === 0) && drafts.length === 0;
  const lanes = reviewLanes(groups, now);
  const progress = reviewWeekProgress(groups, doneThisWeek, now);
  const row = (r: WeeklyReview["groups"]["OVERDUE"][number], variant: "first" | "week" | "compact") => <ReviewRow key={r.key} row={r} variant={variant} actions={actions[r.key]} dialogOptions={dialogOptions} accounts={accounts} now={now} cadenceWeeks={cadenceWeeks} showPic={showPic} />;
  const week = allWeek ? lanes.week : lanes.week.slice(0, WEEK_PREVIEW);
  const noNext = allNoNext ? groups.NO_NEXT_STEP : groups.NO_NEXT_STEP.slice(0, NO_NEXT_PREVIEW);
  const laneTitle = "px-5 pb-1 pt-4 text-sm font-semibold text-zinc-900";
  return <>
    <section aria-label="Tiến độ tuần" className="tf-panel px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px]">
        <p><span className="font-semibold tabular-nums text-zinc-900">{progress.label}</span> <span className="text-zinc-500">việc tuần này đã có kết quả</span></p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-600">{progress.segments.map(s => <li key={s.key} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${SEGMENT_COLORS[s.key]}`} />{s.label} <span className="tabular-nums">{s.count}</span></li>)}</ul>
      </div>
      <div aria-hidden="true" className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-zinc-100">{progress.segments.map(s => s.percent > 0 && <i key={s.key} className={`block h-full ${SEGMENT_COLORS[s.key]}`} style={{ width: `${s.percent}%` }} />)}</div>
    </section>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_290px] lg:items-start">
      {empty ? <div className="min-w-0">{emptyState}</div> : <section aria-label="Việc chăm sóc tuần này" className="tf-panel min-w-0 overflow-hidden pb-2">
        <h2 id="crm-lane-first" className={laneTitle}>Cần làm trước <span className="font-normal tabular-nums text-zinc-500">{lanes.first.length}</span></h2>
        {lanes.first.length ? <div role="list" aria-labelledby="crm-lane-first" className="divide-y divide-zinc-100">{lanes.first.map(r => <div role="listitem" key={r.key}>{row(r, "first")}</div>)}</div> : <p className="px-5 py-3 text-sm text-zinc-500">Không có việc trễ hay đến hạn hôm nay.</p>}
        <h2 id="crm-lane-week" className={`${laneTitle} mt-2 border-t border-zinc-100`}>Trong tuần <span className="font-normal tabular-nums text-zinc-500">{lanes.week.length}</span></h2>
        {lanes.week.length ? <div role="list" aria-labelledby="crm-lane-week" className="divide-y divide-zinc-100">{week.map(r => <div role="listitem" key={r.key}>{row(r, "week")}</div>)}</div> : <p className="px-5 py-3 text-sm text-zinc-500">Không còn việc khác trong tuần.</p>}
        {lanes.week.length > WEEK_PREVIEW && <button type="button" className="mx-5 my-2 min-h-10 text-sm font-medium text-zinc-600 hover:text-zinc-900" aria-expanded={allWeek} onClick={() => setAllWeek(v => !v)}>{allWeek ? "Thu gọn" : `+ ${lanes.week.length - WEEK_PREVIEW} việc khác trong tuần`}</button>}
      </section>}
      <aside aria-label="Theo dõi thêm" className="grid min-w-0 content-start gap-4">
        <section aria-labelledby="crm-no-next" className="tf-panel px-4 py-3">
          <h2 id="crm-no-next" className="text-[13px] font-semibold">Chưa có bước tiếp theo <span className="font-normal tabular-nums text-zinc-500">· {groups.NO_NEXT_STEP.length}</span></h2>
          {groups.NO_NEXT_STEP.length ? <div className="divide-y divide-zinc-100">{noNext.map(r => <div key={r.key}>{row(r, "compact")}</div>)}</div> : <p className="py-2 text-sm text-zinc-500">Khách nào cũng đã có việc tiếp theo.</p>}
          {groups.NO_NEXT_STEP.length > NO_NEXT_PREVIEW && <button type="button" className="mt-1 min-h-10 text-sm font-medium text-zinc-600 hover:text-zinc-900" aria-expanded={allNoNext} onClick={() => setAllNoNext(v => !v)}>{allNoNext ? "Thu gọn" : `+ ${groups.NO_NEXT_STEP.length - NO_NEXT_PREVIEW} khách`}</button>}
        </section>
        <section aria-labelledby="crm-cleanup" className="tf-panel px-4 py-3 text-[13px]">
          <h2 id="crm-cleanup" className="mb-1 font-semibold">Dọn dữ liệu</h2>
          <details id="crm-unrated">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between"><span>Chưa xếp hạng</span><span className="font-semibold tabular-nums">{unratedCount}</span></summary>
            <div className="pb-2">{unrated}</div>
          </details>
          <details ref={details} id="crm-drafts" className="border-t border-zinc-100">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between"><span>Nháp chờ xác nhận</span><span className="font-semibold tabular-nums">{drafts.length}</span></summary>
            {drafts.length ? <div className="divide-y divide-zinc-100 pb-2">{drafts.map(draft => <ReviewDraft key={draft.id} draft={draft} options={dialogOptions} now={now} />)}</div> : <p className="pb-2 text-zinc-500">Không có nháp.</p>}
          </details>
          {dataToolHref && <Link href={dataToolHref} prefetch={false} className="flex min-h-10 items-center justify-between border-t border-zinc-100 text-zinc-600 hover:text-zinc-900"><span>Nhập tracker và gộp khách trùng</span><span aria-hidden="true">→</span></Link>}
        </section>
        <section aria-labelledby="crm-events" className="tf-panel px-4 py-3 text-[13px]">
          <h2 id="crm-events" className="mb-1 font-semibold">Sự kiện khách 90 ngày tới</h2>
          {upcomingEvents.length ? <ul className="space-y-1.5">{upcomingEvents.map(e => <li key={e.id} className="flex items-baseline justify-between gap-3"><Link href={`/crm/clients/${e.clientId}`} className="min-w-0 truncate hover:underline">{e.clientName} · {e.programLabel}</Link><span className="shrink-0 text-zinc-500">{e.timingLabel}</span></li>)}</ul> : <p className="text-zinc-500">Chưa có sự kiện dự kiến.</p>}
        </section>
      </aside>
    </div>
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
  return <div className="space-y-2 py-2" aria-busy={pending}>
    <div className="min-w-0 space-y-0.5"><p className="text-xs text-zinc-500">{formatCrmDate(draft.occurredAt, now)} · {draft.sourceLabel}</p><p className="break-words text-sm">{draft.title}</p><p className="text-xs text-zinc-500">{draft.clientName}</p></div>
    {draft.canConfirm && <div className="flex flex-wrap gap-2"><button type="button" className="tf-button-secondary min-h-10 md:!min-h-9" disabled={pending} onClick={() => setOpen(true)}>Xác nhận</button><button type="button" className="tf-button-secondary min-h-10 md:!min-h-9" disabled={pending} aria-busy={pending} onClick={dismiss}>{pending && <span className="tf-spinner" />}Bỏ qua</button></div>}
    <TouchpointDialog options={options} triggerVariant="secondary" lockClient renderTrigger={false} open={open} onOpenChange={setOpen} prefill={{ clientId: draft.clientId, opportunityId: draft.opportunityId, confirmDraftId: draft.id, occurredAt: draft.occurredAt.toISOString(), kind: "MEETING" }} onSaved={() => setRemoved(true)} />
  </div>;
}
