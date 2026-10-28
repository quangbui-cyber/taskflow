import { requireUser } from "@/lib/auth";
import ModuleShell from "@/components/ModuleShell";
import AiAssistantWorkspace from "@/components/ai/AiAssistantWorkspace";

export default async function AiPage() {
  const user = await requireUser();
  return <ModuleShell user={user} ai>
    <div className="mx-auto w-full max-w-4xl min-w-0 space-y-5 px-4 py-6">
      <h1 className="tf-ui-heading">Tra cứu nội bộ</h1>
      <AiAssistantWorkspace scope={{ kind: "global" }} />
    </div>
  </ModuleShell>;
}
