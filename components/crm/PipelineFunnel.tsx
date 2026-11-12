import { formatCompactVnd } from "@/lib/crm/opportunityFormat";
import type { funnelFromFlow } from "@/lib/crm/pipelineFlow";

/** crm51 (sketch 006 screen 5): five steps with conversion, then won value against the KpiPlan target (D-20). */
export default function PipelineFunnel({ cared, coveragePercent, funnel, winRate, wonValue, target }: {
  cared: number; coveragePercent: number | null; funnel: ReturnType<typeof funnelFromFlow>;
  winRate: number | null; wonValue: number; target: number | null;
}) {
  const progress = target ? Math.min(100, wonValue / target * 100) : null;
  const steps = [
    { label: "Khách được chăm sóc", value: cared, note: coveragePercent === null ? null : `${coveragePercent}% có việc tiếp theo` },
    { label: "Cơ hội trong kỳ", value: funnel.opened, note: null },
    { label: "Nhận Brief", value: funnel.brief, note: funnel.briefRate === null ? null : `${funnel.briefRate}%` },
    { label: "Bidding", value: funnel.bidding, note: funnel.biddingRate === null ? null : `${funnel.biddingRate}%` },
    { label: "Thắng", value: funnel.won, note: winRate === null ? null : `${winRate}% win rate` },
  ];
  return <section aria-label="Phễu Cơ hội" className="tf-panel grid min-w-0 overflow-hidden sm:grid-cols-3 lg:grid-cols-6">
    {steps.map((step, index) => <div key={step.label} className={`min-w-0 border-zinc-100 px-4 py-3 ${index ? "border-t sm:border-t-0 sm:border-l" : ""}`}>
      <p className="truncate text-xs text-zinc-500">{step.label}</p>
      <p className="mt-0.5 text-[22px] font-semibold tabular-nums text-zinc-950">{step.value}</p>
      {step.note && <span className="inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{step.note}</span>}
    </div>)}
    <div className="min-w-0 border-t border-zinc-100 bg-brand-50 px-4 py-3 sm:col-span-3 lg:col-span-1 lg:border-l lg:border-t-0">
      <p className="text-xs text-zinc-500">Doanh số thắng / mục tiêu</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-950">{formatCompactVnd(wonValue)}<span className="text-zinc-500"> / {target ? formatCompactVnd(target) : "chưa có mục tiêu"}</span></p>
      {progress !== null && <div role="progressbar" aria-label="Doanh số thắng so với mục tiêu" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white"><span className="block h-full rounded-full bg-brand-400" style={{ width: `${progress}%` }} /></div>}
    </div>
  </section>;
}
