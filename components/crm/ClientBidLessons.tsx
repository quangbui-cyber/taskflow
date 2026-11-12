import Link from "next/link";
import { OPPORTUNITY_OUTCOMES, OPPORTUNITY_STAGES } from "@/lib/crm/labels";
import { vnDateKey } from "@/lib/crm/dates";

type Item = { id: string; name: string; outcome: string | null; stage?: string; closedAt: Date | null; createdAt: Date; briefSummary: string | null; winStrategy: string | null; outcomeNote: string | null; lessons: string | null; outcomeReasonLabel: string | null };
const monthYear = (date: Date) => { const [y, m] = vnDateKey(date).split("-"); return `${m}/${y}`; };

/** Gathers what Opportunities already record (brief, strategy, outcome reason and note, lessons); nothing new is stored. */
export default function ClientBidLessons({ items, counts, frequentCompetitors, winners }: { items: Item[]; counts: { won: number; lost: number; cancelled: number; declined: number }; frequentCompetitors: string[]; winners: Record<string, string> }) {
  const total = counts.won + counts.lost + counts.cancelled + counts.declined;
  return <div className="space-y-4">
    {(total > 0 || frequentCompetitors.length > 0) && <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-zinc-500">
      {total > 0 && <span>Thắng <b className="font-semibold text-zinc-900">{counts.won}</b> · Thua <b className="font-semibold text-zinc-900">{counts.lost}</b> · Khách hủy <b className="font-semibold text-zinc-900">{counts.cancelled}</b> · CS không tham gia <b className="font-semibold text-zinc-900">{counts.declined}</b></span>}
      {frequentCompetitors.length > 0 && <span>Đối thủ hay gặp: <b className="font-semibold text-zinc-900">{frequentCompetitors.join(", ")}</b></span>}
    </p>}
    {items.length ? <ol className="divide-y divide-zinc-100">{items.map((item) => {
      const state = item.outcome ? OPPORTUNITY_OUTCOMES.find((o) => o.key === item.outcome) : OPPORTUNITY_STAGES.find((s) => s.key === item.stage);
      const lines = [
        item.briefSummary && ["Brief", item.briefSummary],
        item.winStrategy && ["Chiến lược", item.winStrategy],
        item.outcomeReasonLabel && ["Lý do", item.outcomeReasonLabel],
        winners[item.id] && ["Agency thắng", winners[item.id]],
        item.outcomeNote && ["Ghi chú kết quả", item.outcomeNote],
      ].filter((line): line is [string, string] => !!line);
      return <li key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-3 text-[13px]">
        <span className={`tf-badge h-fit font-normal ${state?.className ?? "bg-zinc-100 text-zinc-500"}`}>{state?.label ?? "Đang mở"}</span>
        <div className="min-w-0 space-y-1">
          <p><Link href={`/crm/opportunities/${item.id}`} className="font-semibold hover:underline">{item.name}</Link><span className="text-zinc-500"> · {monthYear(item.closedAt ?? item.createdAt)}</span></p>
          {lines.map(([label, text]) => <p key={label} className="whitespace-pre-wrap break-words"><span className="text-zinc-500">{label}: </span>{text}</p>)}
          {item.lessons && <p className="whitespace-pre-wrap break-words rounded-[10px] bg-zinc-50 px-3 py-2"><span className="text-zinc-500">Bài học: </span>{item.lessons}</p>}
        </div>
      </li>;
    })}</ol> : <p className="text-sm text-zinc-500">Chưa có Cơ hội ghi chiến lược, lý do hay bài học.</p>}
  </div>;
}
