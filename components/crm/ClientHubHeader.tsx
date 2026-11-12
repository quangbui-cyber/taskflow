import Link from "next/link";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import type { HealthSignal, SummaryPart } from "@/lib/crm/clientHub";

const HEALTH_TONES: Record<HealthSignal["tone"], string> = {
  ok: "bg-brand-50 text-brand-700",
  warn: "bg-[#fff7e6] text-[#b86a08]",
  late: "bg-[#fff1ec] text-[#c2410c]",
  none: "bg-zinc-100 text-zinc-500",
};

/** Sentences assembled from stored data only (lib/crm/clientHub buildClientSummary). */
export function ClientHubSummary({ sentences }: { sentences: SummaryPart[][] }) {
  return <p className="max-w-[760px] text-[15px] leading-relaxed text-zinc-700" data-testid="client-summary">
    {sentences.map((parts, i) => <span key={i}>{i > 0 && " "}{parts.map((part, j) => part.strong ? <b key={j} className="font-semibold text-zinc-900">{part.text}</b> : <span key={j}>{part.text}</span>)}</span>)}
  </p>;
}

function Tile({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-[14px] border border-zinc-200 bg-white px-4 py-3 ${className}`} role="group" aria-label={title}>
    <h2 className="text-xs text-zinc-500">{title}</h2>
    <div className="mt-1.5 min-w-0 text-[13px]">{children}</div>
  </div>;
}

export function ClientHubTiles({ health, team, next, upcoming }: { health: HealthSignal[]; team: ReactNode; next: ReactNode; upcoming: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <Tile title="Sức khỏe quan hệ">
      <ul className="flex flex-wrap gap-1.5" aria-label="Tín hiệu sức khỏe quan hệ">
        {health.map((signal) => <li key={signal.key} title={signal.title} data-health={signal.key} data-tone={signal.tone} className={`rounded-full px-2 py-0.5 text-xs ${HEALTH_TONES[signal.tone]}`}><span className="sr-only">{signal.title}: </span>{signal.label}</li>)}
      </ul>
    </Tile>
    <Tile title="Đội phụ trách">{team}</Tile>
    <Tile title="Việc tiếp theo" className="border-brand-100 bg-brand-50/60">{next}</Tile>
    <Tile title="Sắp tới">{upcoming}</Tile>
  </div>;
}

export type HubNavItem = { key: string; label: string; href?: string; badge?: number; lockedReason?: string };
/** Section navigation: sticky column on desktop, horizontal scroller on mobile. */
export function ClientHubNav({ items, current }: { items: HubNavItem[]; current: string }) {
  return <nav aria-label="Mục hồ sơ khách" className="tf-panel relative -mx-1 flex gap-1 overflow-x-auto p-1.5 text-[13px] [scrollbar-width:none] lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:p-2">
    {items.map((item) => {
      if (item.lockedReason || !item.href) return <span key={item.key} aria-disabled="true" title={item.lockedReason} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-zinc-400">
        {item.label}<Lock size={13} aria-hidden="true" /><span className="sr-only">, {item.lockedReason}</span>
      </span>;
      const active = item.key === current;
      return <Link key={item.key} href={item.href} scroll={false} aria-current={active ? "page" : undefined} className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-3 py-2 transition-colors duration-150 ${active ? "bg-zinc-900 font-semibold text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`}>
        {item.label}
        {!!item.badge && <span className={`ml-auto rounded-full px-1.5 text-[11px] tabular-nums ${active ? "bg-white/20 text-white" : "bg-[#fff7e6] text-[#b86a08]"}`} aria-label={`${item.badge} mục trống`}>{item.badge}</span>}
      </Link>;
    })}
  </nav>;
}
