import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AiSourceNotFoundError, requireAiProjectRead } from "@/lib/ai/access/resolveAiReadScope";
import { loadAiConfig } from "@/lib/ai/config";
import ModuleShell from "@/components/ModuleShell";
import ProjectTabs from "@/components/ProjectTabs";
import ProjectAiWorkspace, { type AiSourceOption } from "@/components/ai/ProjectAiWorkspace";

export default async function ProjectAiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  try { await requireAiProjectRead(user.id, id); }
  catch (error) { if (error instanceof AiSourceNotFoundError) notFound(); throw error; }

  const [project, files, invoiceFiles] = await Promise.all([
    prisma.project.findUnique({ where: { id }, select: { name: true } }),
    prisma.projectFile.findMany({ where: { projectId: id, driveFileId: null, data: { not: null } },
      select: { id: true, name: true, mimeType: true, createdAt: true },
      orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.vendorInvoiceFile.findMany({ where: { invoice: { projectId: id } },
      select: { id: true, name: true, mimeType: true, sha256: true, createdAt: true,
        invoice: { select: { businessKey: true } } },
      orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  if (!project) notFound();
  const sources: AiSourceOption[] = [
    ...files.filter((file) => ["application/pdf", "text/plain", "application/xml", "text/xml"].includes(file.mimeType))
      .map((file) => ({ id: `PROJECT_FILE:${file.id}`, name: file.name,
      kind: "Tệp dự án", mimeType: file.mimeType, version: file.createdAt.toISOString(),
      hashPrefix: null, businessKey: null, createdAt: file.createdAt.toISOString() })),
    ...invoiceFiles.map((file) => ({ id: `VENDOR_INVOICE_FILE:${file.id}`, name: file.name,
      kind: "Hóa đơn VAT", mimeType: file.mimeType, version: file.sha256,
      hashPrefix: file.sha256.slice(0, 12), businessKey: file.invoice.businessKey,
      createdAt: file.createdAt.toISOString() })),
  ];
  let providerEnabled = false;
  try { const config = loadAiConfig(); providerEnabled = config.enabled && config.tasks.includes("DOCUMENT_EXTRACTION"); }
  catch { providerEnabled = false; }
  return <ModuleShell user={user} projectId={id}>
    <div className="tf-module-page min-w-0">
      <div className="tf-module-breadcrumb"><Link href={`/projects/${id}`}>Dự án</Link><ChevronRight size={12} aria-hidden="true" /><span>AI</span></div>
      <ProjectTabs projectId={id} active="ai" fileCount={files.length} showAi />
      <div className="tf-module-identity mt-5"><span className="tf-module-mark"><Sparkles size={24} aria-hidden="true" /></span><div>
        <h1 className="tf-module-title">AI · {project.name}</h1>
        <p className="tf-module-description">Trích xuất và rà soát chứng từ trong dự án</p>
      </div></div>
      <ProjectAiWorkspace projectId={id} projectName={project.name} sources={sources}
        providerEnabled={providerEnabled} />
    </div>
  </ModuleShell>;
}
