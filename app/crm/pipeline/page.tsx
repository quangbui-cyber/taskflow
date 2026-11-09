import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import TouchpointDialog from "@/components/crm/TouchpointDialog";
import PipelineFilters from "@/components/crm/PipelineFilters";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled } from "@/lib/features";
import { loadCrmActor } from "@/lib/crm/actor";
import { loadTouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import { getCrmSettings } from "@/lib/crm/settings";
import { loadPipelineReport } from "@/lib/crm/pipelineData";
import { parsePipelineFilters, PIPELINE_PERIODS, winRateTile, outsideTile } from "@/lib/crm/pipelineReport";
import { OPPORTUNITY_STAGES } from "@/lib/crm/labels";
import { formatCompactVnd } from "@/lib/crm/opportunityFormat";

const th = "px-5 py-3 text-left text-xs font-semibold text-zinc-500";
const td = "px-5 py-4 text-sm";
export default async function PipelinePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  if (!crmEnabled()) notFound();
  const actor = await loadCrmActor(user);
  const settings = await getCrmSettings(prisma);
  const filters = parsePipelineFilters(params);
  const [report, dialogOptions, projects] = await Promise.all([
    loadPipelineReport(prisma, filters, settings.pipelineMode, new Date()),
    loadTouchpointDialogOptions(prisma, actor, {}),
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const { coverage, careToBrief } = report.tiles;
  const win = winRateTile(report.tiles.winRate), outside = outsideTile(report.tiles.outside);
  const tiles = [
    { label: "Độ phủ bước tiếp theo", value: coverage.percent === null ? "-" : `${coverage.percent}%`, caption: `${coverage.covered}/${coverage.total} khách đang chăm sóc` },
    { label: "Chăm sóc → Brief", value: `${careToBrief.reached}/${careToBrief.total}`, caption: `${careToBrief.open} đang mở` },
    { label: "Tỷ lệ thắng cạnh tranh", ...win },
    { label: "Ngoài win rate", ...outside },
  ];
  const simpleReasons = [
    { title: "Khách hủy", rows: report.endReasons.cancelled },
    { title: "CS không tham gia", rows: report.endReasons.declined },
  ];
  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmPipeline" />
    <main className="tf-main"><HubTabs section="crmPipeline" role={user.role} />
      <div className="tf-page space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="tf-page-title">Pipeline và hiệu quả</h1><p className="tf-page-subtitle">{report.scope.subtitle}</p></div>
          <TouchpointDialog options={dialogOptions} triggerVariant="secondary" triggerLabel="Ghi điểm chạm" />
        </header>
        <nav aria-label="Kỳ báo cáo" className="flex flex-wrap gap-2">
          {/* Quý này / Quý trước / Năm nay share the pure period definitions. */}
          {PIPELINE_PERIODS.map(option => {
            const query = new URLSearchParams(report.filters.key);
            query.set("period", option.key);
            const selected = report.filters.period === option.key;
            return <Link key={option.key} href={`/crm/pipeline?${query}`} prefetch={false} aria-current={selected ? "page" : undefined}
              className={`min-h-10 rounded-full border px-3 py-2 text-sm transition-colors ${selected ? "bg-zinc-900 text-white border-zinc-900" : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>{option.label}</Link>;
          })}
        </nav>
        <PipelineFilters key={report.filters.key} filters={report.filters} teams={report.options.teams} programTypes={report.options.programTypes} />
        <div className="tf-metric-strip">
          {tiles.map(tile => <section key={tile.label} aria-label={tile.label} className="tf-metric-item">
            <h2 className="text-xs font-semibold text-zinc-500">{tile.label}</h2>
            <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">{tile.value}</p>
            <p className="mt-1 text-xs text-zinc-400">{tile.caption}</p>
          </section>)}
        </div>
        {report.isEmpty ? <div className="tf-empty">
          <h2 className="text-base font-semibold text-zinc-900">Chưa có Cơ hội trong kỳ này</h2>
          <p className="mt-2 text-sm text-zinc-500">Chọn kỳ khác hoặc mở Cơ hội từ hồ sơ khách.</p>
        </div> : <>
          <section aria-labelledby="pipeline-open" className="tf-panel min-w-0 overflow-hidden">
            <h2 id="pipeline-open" className="border-b border-zinc-100 px-5 py-3 text-base font-semibold">Pipeline đang mở</h2>
            <div className="overflow-x-auto" role="region" aria-label="Bảng pipeline đang mở" tabIndex={0}>
              <table className="w-full min-w-[640px] border-collapse text-zinc-700">
                <thead><tr><th scope="col" className={th}>Stage</th><th scope="col" className={`${th} text-right`}>Số Cơ hội</th><th scope="col" className={`${th} text-right`}>Ngân sách dự kiến</th><th scope="col" className={`${th} text-right`}>Bước tiếp quá hạn</th></tr></thead>
                <tbody>{report.openPipeline.map(row => {
                  const stage = OPPORTUNITY_STAGES.find(s => s.key === row.stage)!;
                  return <tr key={row.stage} className="border-t border-zinc-100">
                    <td className={td}><span className={`tf-badge ${stage.className}`}>{stage.label}</span></td>
                    <td className={`${td} text-right tabular-nums`}>{row.count}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatCompactVnd(row.budget)}</td>
                    <td className={`${td} text-right tabular-nums ${row.overdueNextSteps > 0 ? "text-[#b86a08]" : ""}`}>{row.overdueNextSteps}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </section>
          <section aria-labelledby="pipeline-quality" className="space-y-4">
            <h2 id="pipeline-quality" className="text-base font-semibold">Chất lượng tiếp cận</h2>
            {report.quality.map(bar => <div key={bar.level} className="grid grid-cols-[minmax(0,170px)_minmax(40px,1fr)_32px] items-center gap-4 text-sm">
              <span>{bar.label}</span><div className="h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-2 rounded-full bg-zinc-900" style={{ width: `${bar.percent}%` }} /></div><span className="text-right tabular-nums">{bar.count}</span>
            </div>)}
          </section>
          <section aria-labelledby="pipeline-reasons" className="min-w-0 space-y-4">
            <h2 id="pipeline-reasons" className="text-base font-semibold">Lý do kết thúc</h2>
            <section aria-labelledby="pipeline-lost" className="tf-panel min-w-0 overflow-hidden">
              <h3 id="pipeline-lost" className="border-b border-zinc-100 px-5 py-3 text-sm font-semibold">Thua cạnh tranh</h3>
              {report.endReasons.lost.length === 0 ? <p className="px-5 py-4 text-sm text-zinc-400">Chưa có deal.</p> : <div className="overflow-x-auto" role="region" aria-label="Bảng lý do thua cạnh tranh" tabIndex={0}><table className="w-full min-w-[760px] border-collapse text-zinc-700">
                <thead><tr>{["Lý do", "Số deal", "Loại chương trình chính", "Có kế hoạch lấy lại", "Thành brief mới"].map(label => <th key={label} scope="col" className={th}>{label}</th>)}</tr></thead>
                <tbody>{report.endReasons.lost.map(row => <tr key={row.reasonLabel} className="border-t border-zinc-100">
                  <td className={td}>{row.reasonLabel}</td><td className={`${td} tabular-nums`}>{row.count}</td><td className={td}>{report.options.programTypes.find(p => p.code === row.mainProgramTypeCode)?.label ?? row.mainProgramTypeCode}</td><td className={`${td} tabular-nums`}>{row.withWinback}</td><td className={`${td} tabular-nums`}>{row.newBrief}</td>
                </tr>)}</tbody>
              </table></div>}
            </section>
            <div className="grid gap-4 sm:grid-cols-2">{simpleReasons.map(group => <section key={group.title} aria-label={group.title} className="tf-panel min-w-0 overflow-hidden">
              <h3 className="border-b border-zinc-100 px-5 py-3 text-sm font-semibold">{group.title}</h3>
              {group.rows.length === 0 ? <p className="px-5 py-4 text-sm text-zinc-400">Chưa có deal.</p> : <table className="w-full border-collapse text-zinc-700"><thead><tr><th scope="col" className={th}>Lý do</th><th scope="col" className={`${th} text-right`}>Số deal</th></tr></thead><tbody>{group.rows.map(row => <tr key={row.reasonLabel} className="border-t border-zinc-100"><td className={`${td} break-words`}>{row.reasonLabel}</td><td className={`${td} text-right tabular-nums`}>{row.count}</td></tr>)}</tbody></table>}
            </section>)}</div>
          </section>
          <section aria-labelledby="pipeline-usage" className="space-y-4">
            <h2 id="pipeline-usage" className="text-base font-semibold">Mức sử dụng</h2>
            <dl className="grid gap-4 sm:grid-cols-3 text-sm">
              <div><dt className="text-zinc-500">Việc quá hạn</dt><dd className="mt-2 tabular-nums">{report.usage.overdue}</dd></div>
              <div><dt className="text-zinc-500">Nháp chưa xác nhận</dt><dd className="mt-2 tabular-nums">{report.usage.draftCount}{report.usage.oldestDraftDays !== null && <span className="ml-2 text-xs text-zinc-400">cũ nhất {report.usage.oldestDraftDays} ngày</span>}</dd></div>
              <div><dt className="text-zinc-500">Điểm chạm trong kỳ</dt><dd className="mt-2 tabular-nums">{report.usage.touchpoints}</dd></div>
            </dl>
          </section>
        </>}
      </div>
    </main>
  </div>;
}
