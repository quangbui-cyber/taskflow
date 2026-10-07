import { requireUser } from "@/lib/auth";
import { loadWorkflow } from "@/lib/workflow/service";
import { WorkflowPanel } from "@/components/WorkflowPanel";
import ModuleShell from "@/components/ModuleShell";

export default async function WorkflowPage() {
  const user = await requireUser();
  const data = await loadWorkflow(user);
  return <ModuleShell user={user} workflow><WorkflowPanel data={JSON.parse(JSON.stringify(data))} user={user} /></ModuleShell>;
}
