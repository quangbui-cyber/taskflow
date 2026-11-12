import Link from "next/link";
import { formatCrmDate } from "@/lib/crm/dates";
import { OPPORTUNITY_STAGES } from "@/lib/crm/labels";
import { formatBudgetRange } from "@/lib/crm/opportunityFormat";
import { budgetSpan, timelineBuckets, type BoardCard } from "@/lib/crm/opportunityList";

/** crm51 (sketch 006 screen 4): open Opportunities grouped by expected organization month or quarter. */
export default function OpportunityTimeline({ cards, now }: { cards: BoardCard[]; now: Date }) {
  const buckets = timelineBuckets(cards.filter(c => c.outcome === null));
  if (!buckets.length) return <section className="tf-panel p-8 text-center text-sm text-zinc-500">Chưa có Cơ hội đang mở.</section>;
  return <ol aria-label="Cơ hội theo thời gian tổ chức" className="relative space-y-5 border-l border-zinc-200 pl-5">
    {buckets.map(bucket => {
      const span = budgetSpan(bucket.cards);
      return <li key={bucket.key} className="relative">
        <span aria-hidden="true" className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-400 ring-1 ring-zinc-200" />
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">{bucket.label}<span className="text-xs font-normal text-zinc-500">{bucket.cards.length} Cơ hội{span ? ` · ${formatBudgetRange(span.min, span.max)}` : ""}</span></h2>
        <ul className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">{bucket.cards.map(card => {
          const stage = OPPORTUNITY_STAGES.find(s => s.key === card.stage);
          return <li key={card.id} className="min-w-0 rounded-[12px] border border-zinc-200 bg-white px-3 py-2.5 text-[13px]">
            <div className="flex items-center justify-between gap-2"><span className={`tf-badge ${stage?.className ?? "bg-zinc-100 text-zinc-700"}`}>{stage?.label ?? card.stage}</span><span className="truncate text-xs text-zinc-500">{card.programTypeLabel}</span></div>
            <Link href={`/crm/opportunities/${card.id}`} className="mt-1.5 block break-words font-semibold hover:underline">{card.clientName} · {card.name}</Link>
            <p className="mt-1 truncate text-xs text-zinc-500">{[card.pic?.name, card.nextStep ? `${card.nextStep.title}${card.nextStep.dueDate ? ` · ${formatCrmDate(card.nextStep.dueDate, now)}` : ""}` : "Chưa có việc tiếp theo"].filter(Boolean).join(" · ")}</p>
          </li>;
        })}</ul>
      </li>;
    })}
  </ol>;
}
