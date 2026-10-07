import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadWorkflow } from "@/lib/workflow/service";
import { WorkflowDocumentPanel } from "@/components/WorkflowPanel";
import ModuleShell from "@/components/ModuleShell";
import { loadSubmissionView } from "@/lib/workflow/submissions";

export default async function DocumentPage({ params,searchParams }: { params: Promise<{ id: string }>; searchParams:Promise<{attempt?:string|string[]}> }) {
  const user = await requireUser(); const { id } = await params;
  const {attempt} = await searchParams;
  if (Array.isArray(attempt)) notFound();
  const submission = await loadSubmissionView(id,attempt,user);
  if (!submission) notFound();
  const detail = submission.detail;
  const list = await loadWorkflow(user);
  return <ModuleShell user={user} workflow><WorkflowDocumentPanel key={submission.selection} submission={JSON.parse(JSON.stringify(submission))} user={user} detail={JSON.parse(JSON.stringify(detail))} templates={JSON.parse(JSON.stringify(list.templates))} projects={list.projects} /></ModuleShell>;
}
