import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { loadCampaignList } from "@/lib/crm/campaignData";
import { CAMPAIGN_STATUS_CLASS, CAMPAIGN_STATUS_LABELS } from "@/lib/crm/campaignPlan";
import { formatCrmDate } from "@/lib/crm/dates";

/** crm52: care campaigns. Only people with CRM access reach this page (crm54). */
export default async function CampaignsPage() {
  const user = await requireUser();
  if (!(await crmAllowed(user))) notFound();
  const actor = await loadCrmActor(user);
  const now = new Date();
  const [rows, projects] = await Promise.all([
    loadCampaignList(prisma, actor),
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const canCreate = crmCan(actor, "MANAGE_CAMPAIGN");
  const running = rows.filter((r) => r.status === "ACTIVE" || r.status === "PAUSED").length;
  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmCampaigns" />
    <main className="tf-main"><HubTabs section="crmCampaigns" role={user.role} />
      <div className="tf-page space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="tf-page-title">Chiến dịch</h1><p className="tf-page-subtitle">{running} đang chạy · {rows.length} chiến dịch</p></div>
          {canCreate && <Link href="/crm/campaigns/new" className="tf-button-primary">+ Chiến dịch mới</Link>}
        </header>
        {rows.length ? <section className="tf-panel overflow-hidden" aria-label="Danh sách chiến dịch">
          <ul className="divide-y divide-zinc-100">
            {rows.map((row) => {
              const total = row.doneTasks + row.openTasks;
              const pct = total ? Math.round((row.doneTasks / total) * 100) : 0;
              return <li key={row.id}>
                <Link href={`/crm/campaigns/${row.id}`} className="grid gap-3 px-5 py-4 transition-colors duration-150 hover:bg-zinc-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="break-words font-semibold text-zinc-900">{row.name}</span><span className={`tf-badge ${CAMPAIGN_STATUS_CLASS[row.status]}`}>{CAMPAIGN_STATUS_LABELS[row.status]}</span></div>
                    <p className="text-xs text-zinc-500">{[`${formatCrmDate(row.startDate, now)}${row.endDate ? ` - ${formatCrmDate(row.endDate, now)}` : ""}`, `${row.clients} khách`, `${row.stepCount} bước`, row.teamName, row.goal].filter(Boolean).join(" · ")}</p>
                  </div>
                  {row.status !== "DRAFT" && <div className="flex items-center gap-3 sm:w-56">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100" role="img" aria-label={`Đã xong ${row.doneTasks}/${total} việc`}><div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} /></div>
                    <span className="text-xs tabular-nums text-zinc-500">{row.doneTasks}/{total} việc</span>
                  </div>}
                </Link>
              </li>;
            })}
          </ul>
        </section> : <section className="tf-panel px-5 py-10 text-center text-sm text-zinc-500">Chưa có chiến dịch nào.</section>}
      </div>
    </main>
  </div>;
}
