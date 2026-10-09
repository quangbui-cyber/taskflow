import { getCurrentUser } from "@/lib/auth";
import { previewMime } from "@/lib/costflow/icEvidence";
import { findActualCostEvidenceForActor } from "@/lib/costflow/actualCostService";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Not found", { status: 404 });
  const { id, evidenceId } = await params;
  const evidence = await findActualCostEvidenceForActor(id, evidenceId, actor);
  if (!evidence) return new Response("Not found", { status: 404 });
  const mime = previewMime(evidence.mimeType, evidence.data);
  if (!mime) return new Response("Định dạng này chỉ hỗ trợ tải về.", { status: 415 });
  return new Response(new Uint8Array(evidence.data), { headers: { "Content-Type": mime, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(evidence.name)}`, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "sandbox; frame-ancestors 'self'; default-src 'none';", "Cache-Control": "private, no-store" } });
}
