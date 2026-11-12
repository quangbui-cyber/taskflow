import Link from "next/link";
import Avatar from "@/components/Avatar";
import type { ClientCardExtras, ClientListData } from "@/lib/crm/clientData";
import { CLIENT_LIFECYCLE_LABELS, type ClientLifecycle } from "@/lib/crm/clientLifecycle";
import { formatCrmDate, vnDateKey } from "@/lib/crm/dates";
import { OUTCOME_LEVELS } from "@/lib/crm/labels";
import { formatCompactVnd } from "@/lib/crm/opportunityFormat";
import { dueLabel } from "@/lib/crm/reviewView";
import { TierSquare } from "./TierBadge";

const LIFECYCLE_TONE: Record<ClientLifecycle, string> = { PROSPECT: "bg-zinc-100 text-zinc-600", ACTIVE: "bg-[#effaf2] text-[#15803d]", DORMANT: "bg-[#eff6ff] text-[#2563eb]", ARCHIVED: "border border-dashed border-zinc-300 text-zinc-500" };
const MONTH_TONE = ["bg-zinc-100", "bg-[#dced9b]", "bg-[#a8d431]"] as const;
const TOUCH_TONE = (level: number | null) => level === null ? "bg-zinc-300" : level >= 3 ? "bg-[#15803d]" : level === 2 ? "bg-[#f59e0b]" : "bg-[#c2410c]";
type Row = ClientListData["rows"][number];

/** crm51 (sketch 006 screen 2): one card per client with season strip, last four touches and appointment state. */
export default function ClientCards({ rows, extras, now }: { rows: Row[]; extras: Map<string, ClientCardExtras>; now: Date }) {
  const currentMonth = Number(vnDateKey(now).slice(5, 7));
  return <ul aria-label="Thẻ khách hàng" className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
    {rows.map(client => {
      const extra = extras.get(client.id);
      const due = client.nextStep?.dueDate ? dueLabel(client.nextStep.dueDate, now) : null;
      const appointment = !client.nextStep ? { label: "Chưa có việc tiếp theo", tone: "bg-zinc-100 text-zinc-600" }
        : due?.tone === "late" ? { label: due.label, tone: "bg-[#fff4ed] text-[#c2410c]" }
        : due?.tone === "warn" ? { label: "Hẹn hôm nay", tone: "bg-[#fff7e6] text-[#b86a08]" }
        : { label: client.nextStep.dueDate ? `Hẹn ${formatCrmDate(client.nextStep.dueDate, now)}` : "Có việc tiếp theo", tone: "bg-zinc-100 text-zinc-600" };
      const touches = extra?.touches ?? [];
      const touchLabel = touches.length ? `4 lần chạm gần nhất: ${touches.map(t => OUTCOME_LEVELS.find(l => l.key === t)?.label ?? "chưa ghi kết quả").join(", ")}` : "Chưa có lần chạm";
      return <li key={client.id} className="flex min-w-0 flex-col gap-2.5 rounded-[16px] border border-zinc-200 bg-white p-3.5 transition-transform duration-150 hover:-translate-y-0.5 motion-reduce:transform-none">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2"><TierSquare tier={client.tier} /><Link href={`/crm/clients/${client.id}`} className="min-w-0 break-words text-sm font-semibold hover:underline">{client.name}</Link></div>
          <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${LIFECYCLE_TONE[client.lifecycle]}`}>{CLIENT_LIFECYCLE_LABELS[client.lifecycle]}</span>
        </div>
        <div className="flex items-baseline justify-between text-xs"><span className="text-zinc-500">Doanh thu 24 tháng</span><span className="font-semibold tabular-nums">{client.revenue24m ? formatCompactVnd(client.revenue24m) : "0"}</span></div>
        <div>
          <ol aria-label="Mùa vụ 12 tháng" className="grid grid-cols-12 gap-0.5">{(extra?.months ?? []).map(m => <li key={m.month} title={m.title ? `T${m.month}: ${m.title}` : `T${m.month}`} className={`h-3.5 rounded-[3px] ${MONTH_TONE[m.level]} ${m.month === currentMonth ? "outline outline-[1.5px] -outline-offset-[1.5px] outline-zinc-900" : ""}`}><span className="sr-only">{`T${m.month}${m.title ? `: ${m.title}` : ""}`}</span></li>)}</ol>
          <div className="mt-1 flex justify-between gap-2 text-[11px] text-zinc-400"><span>T1</span><span className="truncate">{extra?.seasonLabel ?? "Mùa vụ"}</span><span>T12</span></div>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span role="img" aria-label={touchLabel} title={touchLabel} className="inline-flex gap-[3px]">{[0, 1, 2, 3].map(i => <i key={i} className={`block h-[5px] w-[18px] rounded-[3px] ${i < touches.length ? TOUCH_TONE(touches[i]) : "bg-zinc-200"}`} />)}</span>
          <span className={`truncate rounded-full px-2 py-0.5 ${appointment.tone}`}>{appointment.label}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-600">
          <span className="flex min-w-0 items-center gap-1.5">{client.picAccount ? <><Avatar id={client.picAccount.id} name={client.picAccount.name} className="h-5 w-5 text-[10px]" /><span className="truncate">{[client.picAccount.name, client.team?.name].filter(Boolean).join(" · ")}</span></> : <span className="text-zinc-400">Chưa giao PIC</span>}</span>
          <span className="shrink-0 text-zinc-500">{client.openOpportunityCount ? `${client.openOpportunityCount} Cơ hội mở` : "Chưa có Cơ hội"}</span>
        </div>
      </li>;
    })}
  </ul>;
}
