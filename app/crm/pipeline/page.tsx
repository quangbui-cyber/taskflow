import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import TouchpointDialog from "@/components/crm/TouchpointDialog";
import PipelineFilters from "@/components/crm/PipelineFilters";
import PipelineFunnel from "@/components/crm/PipelineFunnel";
import PipelineSankey from "@/components/crm/PipelineSankey";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { loadTouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import { getCrmSettings } from "@/lib/crm/settings";
import { loadPipelineReport } from "@/lib/crm/pipelineData";
import { parsePipelineFilters, PIPELINE_PERIODS, winRateTile } from "@/lib/crm/pipelineReport";
import { outsideWinRateTile } from "@/lib/crm/pipelineView";
import { funnelFromFlow } from "@/lib/crm/pipelineFlow";
import { OPPORTUNITY_STAGES } from "@/lib/crm/labels";
import { formatCompactVnd } from "@/lib/crm/opportunityFormat";

const th = "px-5 py-3 text-left text-xs font-semibold text-zinc-500";
const td = "px-5 py-4 text-sm";
export default async function PipelinePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  if (!(await crmAllowed(user))) notFound();
  const actor = await loadCrmActor(user);
  const settings = await getCrmSettings(prisma);
  const filters = parsePipelineFilters(params);
  const [report, dialogOptions, projects] = await Promise.all([
    loadPipelineReport(prisma, filters, settings.pipelineMode, new Date()),
    loadTouchpointDialogOptions(prisma, actor, {}),
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const win = winRateTile(report.tiles.winRate);
  const funnel = funnelFromFlow(report.overview.flow);
  const outside = outsideWinRateTile(report.tiles.outside);
  const reasonBars = [
    ...report.endReasons.lost.map(row => ({ key: `lost-${row.reasonLabel}`, label: row.reasonLabel, group: "Thua cạnh tranh", count: row.count, tone: "bg-[#dc2626]" })),
    ...report.endReasons.cancelled.map(row => ({ key: `cancelled-${row.reasonLabel}`, label: row.reasonLabel, group: "Khách hủy", count: row.count, tone: "bg-[#fb923c]" })),
    ...report.endReasons.declined.map(row => ({ key: `declined-${row.reasonLabel}`, label: row.reasonLabel, group: "CS không tham gia", count: row.count, tone: "bg-zinc-300" })),
  ].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "vi"));
  const maxReason = Math.max(1, ...reasonBars.map(r => r.count));
  const months = report.overview.months;
  const maxMonth = Math.max(1, ...months.months.map(m => m.won + m.expected));
  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmPipeline" />
    <main className="tf-main"><HubTabs section="crmPipeline" role={user.role} />
      <div className="tf-page space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="tf-page-title">Pipeline</h1><p className="tf-page-subtitle">{report.scope.subtitle}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Kỳ báo cáo" className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5">
              {PIPELINE_PERIODS.map(option => {
                const query = new URLSearchParams(report.filters.key);
                query.set("period", option.key);
                const selected = report.filters.period === option.key;
                return <Link key={option.key} href={`/crm/pipeline?${query}`} prefetch={false} aria-current={selected ? "page" : undefined}
                  className={`inline-flex min-h-9 items-center rounded-full px-3.5 text-sm transition-colors duration-150 ${selected ? "bg-zinc-900 font-medium text-white" : "text-zinc-600 hover:text-zinc-900"}`}>{option.label}</Link>;
              })}
            </nav>
            <TouchpointDialog options={dialogOptions} triggerVariant="secondary" triggerLabel="Ghi điểm chạm" />
          </div>
        </header>
        <PipelineFilters key={report.filters.key} filters={report.filters} teams={report.options.teams} programTypes={report.options.programTypes} />
        <PipelineFunnel cared={report.tiles.coverage.total} coveragePercent={report.tiles.coverage.percent} funnel={funnel} winRate={report.tiles.winRate.rate} wonValue={report.overview.wonValue} target={report.overview.target} />
        {report.isEmpty ? <div className="tf-empty">
          <h2 className="text-base font-semibold text-zinc-900">Chưa có Cơ hội trong kỳ này</h2>
          <p className="mt-2 text-sm text-zinc-500">Chọn kỳ khác hoặc mở Cơ hội từ hồ sơ khách.</p>
        </div> : <>
          <section aria-labelledby="pipeline-flow" className="tf-panel min-w-0 p-4 sm:p-5">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 id="pipeline-flow" className="text-sm font-semibold">Dòng chảy Cơ hội</h2><span className="text-xs text-zinc-500">{win.caption} · {outside.caption}</span></div>
            <PipelineSankey flow={report.overview.flow} />
          </section>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <section aria-labelledby="pipeline-reasons" className="tf-panel min-w-0 p-4 sm:p-5">
              <h2 id="pipeline-reasons" className="text-sm font-semibold">Vì sao không thắng</h2>
              {reasonBars.length ? <ul className="mt-3 space-y-2">{reasonBars.map(bar => <li key={bar.key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2rem] items-center gap-3 text-[13px]">
                <span className="min-w-0"><span className="block truncate" title={bar.label}>{bar.label}</span><span className="block text-[11px] text-zinc-400">{bar.group}</span></span>
                <span className="h-2.5 overflow-hidden rounded-full bg-zinc-100"><span className={`block h-full rounded-full ${bar.tone}`} style={{ width: `${bar.count / maxReason * 100}%` }} /></span>
                <span className="text-right tabular-nums">{bar.count}</span>
              </li>)}</ul> : <p className="mt-3 text-sm text-zinc-500">Chưa có Cơ hội kết thúc không thắng trong kỳ.</p>}
              {report.endReasons.lost.length > 0 && <details className="mt-3 text-[13px]">
                <summary className="min-h-10 cursor-pointer py-2 text-zinc-600 hover:text-zinc-900">Thua cạnh tranh: kế hoạch lấy lại và brief mới</summary>
                <div className="overflow-x-auto" role="region" aria-label="Bảng lý do thua cạnh tranh" tabIndex={0}><table className="w-full min-w-[560px] border-collapse text-zinc-700">
                  <thead><tr>{["Lý do", "Số deal", "Loại chương trình chính", "Có kế hoạch lấy lại", "Thành brief mới"].map(label => <th key={label} scope="col" className={th}>{label}</th>)}</tr></thead>
                  <tbody>{report.endReasons.lost.map(row => <tr key={row.reasonLabel} className="border-t border-zinc-100">
                    <td className={td}>{row.reasonLabel}</td><td className={`${td} tabular-nums`}>{row.count}</td><td className={td}>{report.options.programTypes.find(p => p.code === row.mainProgramTypeCode)?.label ?? row.mainProgramTypeCode}</td><td className={`${td} tabular-nums`}>{row.withWinback}</td><td className={`${td} tabular-nums`}>{row.newBrief}</td>
                  </tr>)}</tbody>
                </table></div>
              </details>}
            </section>
            <section aria-labelledby="pipeline-months" className="tf-panel min-w-0 p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="pipeline-months" className="text-sm font-semibold">Doanh số theo tháng tổ chức {months.year}</h2><span className="flex gap-3 text-xs text-zinc-500"><span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-brand-400" />Đã thắng</span><span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-brand-200" />Dự kiến</span></span></div>
              <svg viewBox="0 0 480 150" width="100%" role="img" aria-label={`Đã thắng ${formatCompactVnd(months.totalWon)}, dự kiến từ Cơ hội đang mở ${formatCompactVnd(months.totalExpected)}`} className="mt-2 h-auto">
                {months.months.map((m, i) => {
                  const x = 6 + i * 39.5, base = 128, scale = 112 / maxMonth;
                  const wonH = m.won * scale, expH = m.expected * scale;
                  return <g key={m.month}>
                    {m.expected > 0 && <rect x={x} y={base - wonH - expH} width={28} height={Math.max(1, expH)} rx={4} className="fill-brand-200"><title>{`T${m.month}: dự kiến ${formatCompactVnd(m.expected)}`}</title></rect>}
                    {m.won > 0 && <rect x={x} y={base - wonH} width={28} height={Math.max(1, wonH)} rx={4} className="fill-brand-400"><title>{`T${m.month}: đã thắng ${formatCompactVnd(m.won)}`}</title></rect>}
                    <text x={x + 14} y={145} textAnchor="middle" className="fill-zinc-400 text-[10px]">T{m.month}</text>
                  </g>;
                })}
              </svg>
              <p className="mt-1 text-xs text-zinc-500">Đã thắng {formatCompactVnd(months.totalWon)} · dự kiến {formatCompactVnd(months.totalExpected)}, không cộng vào doanh thu{months.unknownExpected + months.unknownWon > 0 ? ` · chưa rõ tháng ${formatCompactVnd(months.unknownWon + months.unknownExpected)}` : ""}</p>
            </section>
          </div>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <section aria-labelledby="pipeline-open" className="tf-panel min-w-0 p-4 sm:p-5">
              <h2 id="pipeline-open" className="text-sm font-semibold">Đang mở</h2>
              <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]">{report.openPipeline.map(row => {
                const stage = OPPORTUNITY_STAGES.find(s => s.key === row.stage)!;
                return <div key={row.stage} className="min-w-0"><dt className="text-zinc-500">{stage.label}</dt><dd className="mt-0.5 font-semibold tabular-nums">{row.count}<span className="ml-1 font-normal text-zinc-500">{formatCompactVnd(row.budget)}</span></dd>{row.overdueNextSteps > 0 && <dd className="text-xs text-[#b86a08]">{row.overdueNextSteps} việc quá hạn</dd>}</div>;
              })}</dl>
            </section>
            <section aria-labelledby="pipeline-quality" className="tf-panel min-w-0 p-4 sm:p-5">
              <h2 id="pipeline-quality" className="text-sm font-semibold">Chất lượng tiếp cận</h2>
              <ul className="mt-3 space-y-1.5">{report.quality.map(bar => <li key={bar.level} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2rem] items-center gap-3 text-[13px]">
                <span className="truncate">{bar.label}</span><span className="h-2 overflow-hidden rounded-full bg-zinc-100"><span className="block h-2 rounded-full bg-zinc-900" style={{ width: `${bar.percent}%` }} /></span><span className="text-right tabular-nums">{bar.count}</span>
              </li>)}</ul>
              <dl aria-label="Mức sử dụng" className="mt-4 grid grid-cols-3 gap-3 border-t border-zinc-100 pt-3 text-[13px]">
                <div><dt className="text-zinc-500">Việc quá hạn</dt><dd className="mt-0.5 tabular-nums">{report.usage.overdue}</dd></div>
                <div><dt className="text-zinc-500">Nháp chưa xác nhận</dt><dd className="mt-0.5 tabular-nums">{report.usage.draftCount}{report.usage.oldestDraftDays !== null && <span className="ml-1 text-xs text-zinc-400">cũ nhất {report.usage.oldestDraftDays} ngày</span>}</dd></div>
                <div><dt className="text-zinc-500">Điểm chạm trong kỳ</dt><dd className="mt-0.5 tabular-nums">{report.usage.touchpoints}</dd></div>
              </dl>
            </section>
          </div>
        </>}
      </div>
    </main>
  </div>;
}
