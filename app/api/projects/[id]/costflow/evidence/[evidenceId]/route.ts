import { getCurrentUser } from "@/lib/auth";
import { findActualCostEvidenceForActor } from "@/lib/costflow/actualCostService";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Not found", { status: 404 });
  const { id, evidenceId } = await params;
  const evidence = await findActualCostEvidenceForActor(id, evidenceId, actor);
  if (!evidence) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(evidence.data), { headers: { "Content-Type": evidence.mimeType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(evidence.name)}`, "Cache-Control": "private, no-store" } });
}
