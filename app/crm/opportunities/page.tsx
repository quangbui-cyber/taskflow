import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import OpenOpportunityDialog from "@/components/crm/OpenOpportunityDialog";
import TouchpointDialog from "@/components/crm/TouchpointDialog";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled } from "@/lib/features";
import { loadCrmActor } from "@/lib/crm/actor";
import { loadOpenOpportunityDialogOptions, loadTouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import { formatCrmDate } from "@/lib/crm/dates";
import { OPPORTUNITY_OUTCOMES, OPPORTUNITY_STAGES } from "@/lib/crm/labels";
import { formatBudgetRange, formatCompactVnd } from "@/lib/crm/opportunityFormat";
import { loadOpportunityFilterOptions, loadOpportunityList, parseOpportunityListParams, type ClosedOpportunityRow, type OpenOpportunityRow, type OpportunityListParams, type OpportunityListView } from "@/lib/crm/opportunityList";

const VIEWS: { key: OpportunityListView; label: string }[] = [
  { key: "OPEN", label: "Đang mở" }, { key: "CARE", label: "Chăm sóc" },
  { key: "BRIEF", label: "Brief" }, { key: "BIDDING", label: "Bidding" }, { key: "CLOSED", label: "Đã kết thúc" },
];
function listHref(params: OpportunityListParams, patch: Partial<OpportunityListParams> = {}) {
  const value = { ...params, ...patch };
  const query = new URLSearchParams({ view: value.view });
  if (value.picAccountId) query.set("pic", value.picAccountId);
  if (value.teamId) query.set("team", value.teamId);
  if (value.programTypeCode) query.set("program", value.programTypeCode);
  if (value.page > 1) query.set("page", String(value.page));
  return `/crm/opportunities?${query}`;
}
function OpportunityName({ row }: { row: OpenOpportunityRow | ClosedOpportunityRow }) {
  return <div className="min-w-0 space-y-1 break-words">
    <Link href={`/crm/opportunities/${row.id}`} className="text-sm font-semibold hover:underline">{row.name}</Link>
    <p className="text-xs text-zinc-500">{row.clientName}{row.buyingUnitName ? ` · ${row.buyingUnitName}` : ""}</p>
    {"outcome" in row && row.outcome === "WON" && row.projectId && <Link href={`/projects/${row.projectId}`} className="text-xs text-zinc-500 hover:underline">Project</Link>}
  </div>;
}
function StageBadge({ stage }: { stage: string }) {
  const label = OPPORTUNITY_STAGES.find(item => item.key === stage);
  return <span className={`tf-badge ${label?.className ?? "bg-zinc-100 text-zinc-700"}`}>{label?.label ?? stage}</span>;
}
function OutcomeBadge({ row }: { row: ClosedOpportunityRow }) {
  const label = OPPORTUNITY_OUTCOMES.find(item => item.key === row.outcome);
  return <div className="space-y-1"><span className={`tf-badge ${label?.className ?? "bg-zinc-100 text-zinc-500"}`}>{label?.label ?? row.outcome}</span>
    {row.outcome === "LEGACY_UNCLASSIFIED" && <p className="text-xs text-zinc-500">Giá trị gốc: {row.legacyStatus ?? "-"}</p>}
  </div>;
}
function NextStep({ row, now }: { row: OpenOpportunityRow; now: Date }) {
  return row.nextStep ? <div className="space-y-1 break-words"><p>{row.nextStep.title}</p>
    {row.nextStep.dueDate && <p className={`text-xs ${row.nextStep.overdue ? "text-[#b86a08]" : "text-zinc-500"}`}>hạn {formatCrmDate(row.nextStep.dueDate, now)}</p>}
  </div> : <span className="text-zinc-400">Chưa có bước tiếp theo</span>;
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, raw] = await Promise.all([requireUser(), searchParams]);
  if (!crmEnabled()) notFound();
  const actor = await loadCrmActor(user);
  const params = parseOpportunityListParams(raw);
  const now = new Date();
  const [data, options, touchpointOptions, openOptions, projects] = await Promise.all([
    loadOpportunityList(prisma, params, now), loadOpportunityFilterOptions(prisma),
    loadTouchpointDialogOptions(prisma, actor, {}), loadOpenOpportunityDialogOptions(prisma, actor, {}),
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const filtered = !!(params.picAccountId || params.teamId || params.programTypeCode || params.view !== "OPEN" || params.page > 1);
  const hasRows = !!(data.openRows?.length || data.closedRows?.length);
  const headers = params.view === "CLOSED"
    ? ["Cơ hội", "Kết quả", "Lý do", "Ngày kết thúc", "Giá trị hợp đồng", "PIC"]
    : ["Cơ hội", "Loại chương trình", "Stage", "Thời gian dự kiến", "Ngân sách dự kiến", "PIC", "Bước tiếp theo", "Ở stage"];
  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmOpportunities" />
    <main className="tf-main"><HubTabs section="crmOpportunities" role={user.role} />
      <div className="tf-page space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="tf-page-title">Cơ hội</h1>
          <div className="flex flex-wrap gap-2">
            {!!touchpointOptions.clients.length && <TouchpointDialog options={touchpointOptions} triggerVariant="secondary" />}
            {!!openOptions.clients.length && <OpenOpportunityDialog options={openOptions} triggerVariant="primary" />}
          </div>
        </header>
        <div role="group" aria-label="Stage Cơ hội" className="flex flex-wrap gap-2">
          {VIEWS.map(view => <Link key={view.key} href={listHref(params, { view: view.key, page: 1 })} aria-current={params.view === view.key ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-full border px-4 py-2 text-sm ${params.view === view.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}>{view.label}</Link>)}
        </div>
        <form key={listHref(params)} action="/crm/opportunities" className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          <input type="hidden" name="view" value={params.view} />
          <div><label htmlFor="opportunity-pic" className="block text-sm">PIC</label><select id="opportunity-pic" name="pic" defaultValue={params.picAccountId ?? ""} className="tf-field mt-2"><option value="">Tất cả PIC</option>{options.pics.map(pic => <option key={pic.id} value={pic.id}>{pic.name}</option>)}</select></div>
          <div><label htmlFor="opportunity-team" className="block text-sm">Team</label><select id="opportunity-team" name="team" defaultValue={params.teamId ?? ""} className="tf-field mt-2"><option value="">Tất cả team</option>{options.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>
          <div><label htmlFor="opportunity-program" className="block text-sm">Loại chương trình</label><select id="opportunity-program" name="program" defaultValue={params.programTypeCode ?? ""} className="tf-field mt-2"><option value="">Tất cả loại chương trình</option>{options.programTypes.map(program => <option key={program.code} value={program.code}>{program.label}</option>)}</select></div>
          <button type="submit" className="tf-button-secondary">Lọc</button>
        </form>
        {hasRows ? <section className="tf-panel overflow-hidden" aria-label="Danh sách Cơ hội">
          <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm">
            <thead><tr className="border-b border-zinc-200 text-xs text-zinc-500">{headers.map((label, i) => <th key={label} scope="col" className={`px-5 py-3 font-semibold ${i === 4 ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {data.openRows?.map(row => <tr key={row.id} className="align-top">
                <td className="min-w-44 px-5 py-4"><OpportunityName row={row} /></td>
                <td className="px-5 py-4">{row.programTypeLabel}</td><td className="px-5 py-4"><StageBadge stage={row.stage} /></td>
                <td className="px-5 py-4 tabular-nums">{row.timingLabel}</td>
                <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{formatBudgetRange(row.budgetMin, row.budgetMax) ?? "-"}</td>
                <td className="px-5 py-4">{row.picName ?? "Chưa giao"}</td><td className="min-w-40 px-5 py-4"><NextStep row={row} now={now} /></td>
                <td className="whitespace-nowrap px-5 py-4 tabular-nums">{row.daysInStage} ngày</td>
              </tr>)}
              {data.closedRows?.map(row => <tr key={row.id} className="align-top">
                <td className="min-w-44 px-5 py-4"><OpportunityName row={row} /></td><td className="px-5 py-4"><OutcomeBadge row={row} /></td>
                <td className="px-5 py-4"><p>{row.reasonLabel ?? "-"}</p>{row.outcomeNote && <p className="mt-1 break-words text-xs text-zinc-500">{row.outcomeNote}</p>}</td>
                <td className="px-5 py-4 tabular-nums">{row.closedAt ? formatCrmDate(row.closedAt, now) : "-"}</td>
                <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{row.outcome === "WON" && row.contractValue !== null ? formatCompactVnd(row.contractValue) : null}</td>
                <td className="px-5 py-4">{row.picName ?? "Chưa giao"}</td>
              </tr>)}
            </tbody>
          </table></div>
          <ul className="divide-y divide-zinc-100 md:hidden">
            {data.openRows?.map(row => <li key={row.id} className="space-y-4 p-4 text-sm"><div className="flex items-start justify-between gap-2"><OpportunityName row={row} /><StageBadge stage={row.stage} /></div><p className="text-xs text-zinc-500">PIC: {row.picName ?? "Chưa giao"}</p><NextStep row={row} now={now} /></li>)}
            {data.closedRows?.map(row => <li key={row.id} className="space-y-4 p-4 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><OpportunityName row={row} /><OutcomeBadge row={row} /></div><p className="text-xs text-zinc-500">PIC: {row.picName ?? "Chưa giao"}</p><p>{row.closedAt ? formatCrmDate(row.closedAt, now) : "-"}</p></li>)}
          </ul>
        </section> : <section className="tf-panel p-8 text-center"><div className="tf-empty space-y-4">
          <h2 className="text-sm font-semibold">{filtered ? "Không có kết quả phù hợp bộ lọc." : "Chưa có Cơ hội đang mở"}</h2>
          {filtered ? <Link href="/crm/opportunities" className="tf-button-secondary">Xóa bộ lọc</Link> : <>
            <p className="text-sm text-zinc-500">Mở Cơ hội khi khách có chương trình cụ thể đáng theo đuổi.</p>
            {!!openOptions.clients.length && <OpenOpportunityDialog options={openOptions} triggerVariant="secondary" />}
          </>}
        </div></section>}
        {(params.page > 1 || data.hasMore) && <nav aria-label="Trang Cơ hội" className="flex justify-center gap-4">
          {params.page > 1 && <Link href={listHref(params, { page: params.page - 1 })} className="tf-button-secondary">Trang trước</Link>}
          {data.hasMore && params.page < 100 && <Link href={listHref(params, { page: params.page + 1 })} className="tf-button-secondary">Tải thêm</Link>}
        </nav>}
      </div>
    </main>
  </div>;
}
