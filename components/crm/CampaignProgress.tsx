"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeCampaignStatusAction } from "@/app/actions/crmCampaign";
import { useInteraction } from "@/components/InteractionProvider";
import type { CampaignCell, CampaignDetail } from "@/lib/crm/campaignData";
import { CAMPAIGN_STATUS_CLASS, CAMPAIGN_STATUS_LABELS } from "@/lib/crm/campaignPlan";
import { formatCrmDate, vnDateKey } from "@/lib/crm/dates";

const pct = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : null;

function Cell({ cell, todayKey, now }: { cell: CampaignCell | null; todayKey: string; now: Date }) {
  if (!cell) return <span className="text-zinc-300">-</span>;
  if (cell.status === "DONE") return <span className="tf-badge bg-brand-50 text-brand-800">✓ {cell.outcomeLabel ? cell.outcomeLabel.toLocaleLowerCase("vi") : cell.completedAt ? formatCrmDate(cell.completedAt, now) : "xong"}</span>;
  if (cell.status === "CANCELLED") return <span className="tf-badge bg-zinc-100 text-zinc-500">bỏ qua</span>;
  const dueKey = cell.dueDate ? vnDateKey(cell.dueDate) : null;
  if (dueKey && dueKey < todayKey) {
    const days = Math.round((Date.parse(todayKey) - Date.parse(dueKey)) / 86400000);
    return <span className="tf-badge bg-[#fff1e0] text-[#b86a08]">Trễ {days} ngày</span>;
  }
  if (dueKey === todayKey) return <span className="tf-badge bg-amber-50 text-amber-800">Hôm nay</span>;
  return <span className="tf-badge bg-zinc-50 text-zinc-500">chờ{cell.dueDate ? ` ${formatCrmDate(cell.dueDate, now)}` : ""}</span>;
}

/** crm52 (sketch 006 screen 8): campaign funnel and client x step grid; tasks are completed with Ghi kết quả in Review. */
export default function CampaignProgress({ detail, now }: { detail: CampaignDetail; now: Date }) {
  const { campaign, funnel, rows, steps } = detail;
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { notify } = useInteraction();
  function act(action: "PAUSE" | "RESUME" | "CANCEL" | "FINISH") {
    if (action === "CANCEL" && !window.confirm(`Hủy chiến dịch và ${detail.openTasks} việc chưa làm?`)) return;
    startTransition(async () => {
      const result = await changeCampaignStatusAction({ id: campaign.id, expectedVersion: campaign.version, action });
      if ("error" in result) notify({ message: result.error ?? "Không thực hiện được.", tone: "error" });
      else notify({ message: result.success ?? "Đã cập nhật.", tone: "success" });
      router.refresh();
    });
  }
  const live = campaign.status === "ACTIVE" || campaign.status === "PAUSED";
  const target = funnel.target ?? 0;
  const subtitle = [
    `${formatCrmDate(campaign.startDate, now)}${campaign.endDate ? ` - ${formatCrmDate(campaign.endDate, now)}` : ""}`,
    `${funnel.clients} khách`, `${detail.picCount} PIC`, campaign.teamName,
    campaign.targetOpportunities ? `mục tiêu mở ${campaign.targetOpportunities} Cơ hội` : campaign.goal,
  ].filter(Boolean).join(" · ");
  const stages: [string, number, string | null][] = [
    ["Khách trong chiến dịch", funnel.clients, null],
    ["Đã liên hệ", funnel.contacted, pct(funnel.contacted, funnel.clients)],
    ["Có phản hồi", funnel.responded, pct(funnel.responded, funnel.contacted)],
    ["Có nhu cầu", funnel.needs, pct(funnel.needs, funnel.responded)],
  ];
  const cols = `minmax(180px,1.4fr) repeat(${steps.length}, minmax(120px,1fr)) 140px`;
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><h1 className="tf-page-title break-words">{campaign.name}</h1><p className="tf-page-subtitle">{subtitle}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`tf-badge ${CAMPAIGN_STATUS_CLASS[campaign.status]}`}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</span>
        {detail.canManage && campaign.status === "ACTIVE" && <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => act("PAUSE")}>Tạm dừng</button>}
        {detail.canManage && campaign.status === "PAUSED" && <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => act("RESUME")}>Chạy tiếp</button>}
        {detail.canManage && live && !detail.openTasks && <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => act("FINISH")}>Kết thúc</button>}
        {detail.canManage && live && !!detail.openTasks && <button type="button" className="tf-button-danger" disabled={pending} onClick={() => act("CANCEL")}>Hủy chiến dịch</button>}
      </div>
    </header>
    <section className="tf-panel grid overflow-hidden sm:grid-cols-5" aria-label="Phễu chiến dịch">
      {stages.map(([label, value, conv]) => <div key={label} className="grid gap-1 border-b border-zinc-100 px-5 py-4 sm:border-b-0 sm:border-r">
        <span className="text-xs text-zinc-500">{label}</span>
        <span className="flex items-baseline gap-2"><b className="text-2xl tabular-nums text-zinc-900">{value}</b>{conv && <span className="text-xs tabular-nums text-zinc-500">{conv}</span>}</span>
      </div>)}
      <div className="grid gap-1 bg-brand-50 px-5 py-4">
        <span className="text-xs text-zinc-600">Cơ hội đã mở{target ? " / mục tiêu" : ""}</span>
        <b className="text-2xl tabular-nums text-zinc-900">{funnel.opportunities}{target ? ` / ${target}` : ""}</b>
        {!!target && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white" role="img" aria-label={`${funnel.opportunities} trên ${target} Cơ hội`}><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, Math.round((funnel.opportunities / target) * 100))}%` }} /></div>}
      </div>
    </section>
    <section className="tf-panel overflow-x-auto" aria-label="Tiến độ theo khách">
      <div role="table" className="min-w-max text-sm">
        <div role="row" className="grid gap-3 px-5 py-2.5 text-xs text-zinc-500" style={{ gridTemplateColumns: cols }}>
          <span role="columnheader">Khách</span>
          {steps.map((s) => <span key={s.index} role="columnheader" className="truncate" title={s.title}>N+{s.offsetDays} {s.kindLabel}</span>)}
          <span role="columnheader">Kết quả</span>
        </div>
        {rows.map((r) => <div key={r.targetId} role="row" className="grid items-center gap-3 border-t border-zinc-100 px-5 py-2.5" style={{ gridTemplateColumns: cols }}>
          <span role="cell" className="min-w-0"><Link href={`/crm/clients/${r.clientId}`} className="break-words font-medium text-zinc-900 hover:underline">{r.clientName}</Link>{r.pic && <span className="block text-xs text-zinc-500">{r.pic.name}</span>}</span>
          {r.cells.map((c, i) => <span key={i} role="cell"><Cell cell={c} todayKey={detail.todayKey} now={now} /></span>)}
          <span role="cell">{r.opportunity
            ? <Link href={`/crm/opportunities/${r.opportunity.id}`} className="tf-badge bg-sky-50 text-sky-700 hover:underline">Đã mở Cơ hội</Link>
            : r.status === "STOPPED" ? <span className="text-xs text-zinc-500">{r.stoppedByOpportunity ? "Dừng vì mở Cơ hội" : "Đã dừng"}</span>
              : <span className="text-zinc-400">-</span>}</span>
        </div>)}
        {!rows.length && <p className="px-5 py-8 text-center text-zinc-500">Chưa có khách.</p>}
      </div>
    </section>
  </div>;
}
