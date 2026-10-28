import { getCurrentUser } from "@/lib/auth";
import { openAiCitation } from "@/lib/ai/retrieval/citations";

export async function GET(_request: Request, { params }: { params: Promise<{ spanId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Not found", { status: 404 });
  try {
    const { spanId } = await params;
    const citation = await openAiCitation(actor.id, spanId);
    return Response.json(citation, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
