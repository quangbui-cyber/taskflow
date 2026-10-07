import { getCurrentUser } from "@/lib/auth";
import { loadFinance } from "@/lib/costflow/service";
import { previewMime } from "@/lib/costflow/icEvidence";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { id, evidenceId } = await params;
  const finance = await loadFinance(id, actor);
  if (!finance?.evidence.some(e => e.id === evidenceId)) return new Response("Not found", { status: 404 });
  const evidence = await prisma.costFlowEvidence.findFirst({ where: { id: evidenceId, projectId: id } });
  if (!evidence) return new Response("Not found", { status: 404 });
  const mime = previewMime(evidence.mimeType, evidence.data);
  if (!mime) return new Response("Định dạng này chỉ hỗ trợ tải về.", { status: 415 });
  return new Response(new Uint8Array(evidence.data), { headers: { "Content-Type": mime, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(evidence.name)}`, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "sandbox; frame-ancestors 'self'; default-src 'none';", "Cache-Control": "private, no-store" } });
}
