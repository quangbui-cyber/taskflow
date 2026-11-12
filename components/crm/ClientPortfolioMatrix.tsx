import Link from "next/link";
import type { ClientPortfolioMatrixData } from "@/lib/crm/clientData";
import { CLIENT_LIFECYCLE_LABELS, type ClientLifecycle } from "@/lib/crm/clientLifecycle";
import type { TierValue } from "@/lib/crm/settingsSchema";
import { TierSquare } from "./TierBadge";

const TIER_NAMES: Record<TierValue, string> = { S: "Chiến lược", A: "Quan trọng", B: "Phát triển", C: "Duy trì", UNRATED: "Chưa xếp" };

/** crm51 (sketch 006 screen 2): tier x lifecycle map. A cell links to the same page filtered by both. */
export default function ClientPortfolioMatrix({ matrix, selected, hrefFor }: {
  matrix: ClientPortfolioMatrixData; selected: { tier: TierValue | null; lifecycle: ClientLifecycle | null };
  hrefFor: (tier: TierValue, lifecycle: ClientLifecycle, active: boolean) => string;
}) {
  const lifecycles = matrix[0]?.cells.map(c => c.lifecycle) ?? [];
  return <section aria-labelledby="crm-portfolio" className="tf-panel min-w-0 p-4 sm:p-5">
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 id="crm-portfolio" className="text-sm font-semibold">Danh mục khách theo hạng và vòng đời</h2><span className="inline-flex items-center gap-1.5 text-xs text-zinc-500"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-[#fdba74] bg-[#fff4ed]" />Trễ hẹn</span></div>
    <div className="overflow-x-auto [scrollbar-width:thin]">
      <table className="w-full min-w-[620px] table-fixed border-separate border-spacing-1.5 text-xs">
        <caption className="sr-only">Số khách theo hạng và vòng đời</caption>
        <thead><tr><th scope="col" className="w-[118px]"><span className="sr-only">Hạng</span></th>{lifecycles.map(l => <th key={l} scope="col" className="px-1.5 text-left font-medium text-zinc-500">{CLIENT_LIFECYCLE_LABELS[l]}</th>)}</tr></thead>
        <tbody>{matrix.map(row => <tr key={row.tier}>
          <th scope="row" className="px-1.5 text-left font-medium text-zinc-600"><span className="inline-flex items-center gap-2"><TierSquare tier={row.tier} />{TIER_NAMES[row.tier]}</span></th>
          {row.cells.map(cell => {
            const active = selected.tier === row.tier && selected.lifecycle === cell.lifecycle;
            const label = `${TIER_NAMES[row.tier]}, ${CLIENT_LIFECYCLE_LABELS[cell.lifecycle]}: ${cell.count} khách${cell.overdue ? `, ${cell.overdue} trễ hẹn` : ""}`;
            return <td key={cell.lifecycle} className="align-top">
              {cell.count ? <Link href={hrefFor(row.tier, cell.lifecycle, active)} scroll={false} prefetch={false} aria-label={label} aria-current={active ? "true" : undefined}
                className={`flex min-h-[74px] flex-wrap content-start gap-1 rounded-[12px] border p-2 transition-colors duration-150 ${active ? "border-zinc-900 bg-white shadow-[inset_0_0_0_1px_#18181b]" : "border-zinc-100 bg-zinc-50 hover:border-zinc-300 hover:bg-white"}`}>
                {cell.preview.map(c => <span key={c.id} aria-hidden="true" className={`max-w-full truncate rounded-full border px-2 py-0.5 text-[11.5px] ${c.overdue ? "border-[#fdba74] bg-[#fff4ed]" : "border-zinc-200 bg-white"}`}>{c.name}</span>)}
                {cell.count > cell.preview.length && <span aria-hidden="true" className="rounded-full px-1.5 py-0.5 text-[11.5px] text-zinc-500">+{cell.count - cell.preview.length}</span>}
              </Link> : <div aria-label={label} className="min-h-[74px] rounded-[12px] border border-zinc-100 bg-zinc-50/60" />}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
