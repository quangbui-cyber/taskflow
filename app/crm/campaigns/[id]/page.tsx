import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import CampaignWizard from "@/components/crm/CampaignWizard";
import CampaignProgress from "@/components/crm/CampaignProgress";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { getCrmSettings } from "@/lib/crm/settings";
import { loadCampaignDetail, loadCampaignWizardOptions } from "@/lib/crm/campaignData";
import { vnDateKey } from "@/lib/crm/dates";

/** crm52 (sketch 006 screens 7-8): a DRAFT opens the wizard for its managers; a launched campaign shows tracking. */
export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string | string[] }> }) {
  const [user, { id }, query] = await Promise.all([requireUser(), params, searchParams]);
  const step = typeof query.step === "string" && /^[1-5]$/.test(query.step) ? Number(query.step) - 1 : 0;
  if (!(await crmAllowed(user))) notFound();
  const actor = await loadCrmActor(user);
  const now = new Date();
  const detail = await loadCampaignDetail(prisma, actor, id, now);
  if (!detail || (detail.campaign.status === "DRAFT" && !detail.canManage)) notFound();
  const [options, projects] = await Promise.all([
    detail.draft ? loadCampaignWizardOptions(prisma, actor, await getCrmSettings(prisma)) : null,
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
  ]);
  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmCampaigns" />
    <main className="tf-main"><HubTabs section="crmCampaigns" role={user.role} />
      <div className="tf-page">
        {detail.draft && options
          ? <CampaignWizard key={`${detail.campaign.id}:${step}`} options={options} todayKey={vnDateKey(now)} initial={{ id: detail.campaign.id, version: detail.campaign.version, draft: detail.draft }} initialStep={step} />
          : <CampaignProgress detail={detail} now={now} />}
      </div>
    </main>
  </div>;
}
