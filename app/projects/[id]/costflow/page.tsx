import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadFinance } from "@/lib/costflow/service";
import CostFlowPanel from "@/components/CostFlowPanel";
import ModuleShell from "@/components/ModuleShell";
import ProjectTabs from "@/components/ProjectTabs";
import { ChevronRight, ReceiptText } from "lucide-react";
import { requireAiProjectRead } from "@/lib/ai/access/resolveAiReadScope";

export default async function CostFlowPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const user = await requireUser();
  const finance = await loadFinance(id, user);
  if (!finance) notFound();
  const showAi = finance.fullAccess && await requireAiProjectRead(user.id, id).then(() => true, () => false);
  return <ModuleShell user={user} projectId={id}>
    <div className="tf-module-page tf-costflow-page">
      <div className="tf-module-breadcrumb"><Link href={`/projects/${id}`}>Dự án</Link><ChevronRight size={12} aria-hidden="true" /><span>CostFlow</span></div>
      {finance.fullAccess && <ProjectTabs projectId={id} active="costflow" fileCount={finance.files.length} showAi={showAi} />}
      <CostFlowPanel initialTab={tab} user={user} finance={JSON.parse(JSON.stringify(finance))} projectHeading={<div key="costflow-project-heading" className="tf-module-identity"><span className="tf-module-mark"><ReceiptText size={24} aria-hidden="true" /></span><div><h1 className="tf-module-title">{finance.project.name}</h1><p className="tf-module-description">Theo dõi ngân sách, chi phí phát sinh và quyết toán</p></div></div>} />
    </div>
  </ModuleShell>;
}
