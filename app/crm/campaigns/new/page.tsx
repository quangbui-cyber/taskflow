import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import CampaignWizard from "@/components/crm/CampaignWizard";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { getCrmSettings } from "@/lib/crm/settings";
import { loadCampaignWizardOptions } from "@/lib/crm/campaignData";
import { vnDateKey } from "@/lib/crm/dates";

/** crm52 (sketch 006 screen 7): new campaign wizard for Admin and team CRM managers. */
export default async function NewCampaignPage() {
  const user = await requireUser();
  if (!(await crmAllowed(user))) notFound();
  const actor = await loadCrmActor(user);
  if (!crmCan(actor, "MANAGE_CAMPAIGN")) notFound();
  const settings = await getCrmSettings(prisma);
  const [options, projects] = await Promise.all([
    loadCampaignWizardOptions(prisma, actor, settings),
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
  ]);
  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmCampaigns" />
    <main className="tf-main"><HubTabs section="crmCampaigns" role={user.role} />
      <div className="tf-page"><CampaignWizard options={options} todayKey={vnDateKey(new Date())} initial={null} /></div>
    </main>
  </div>;
}
