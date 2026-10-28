import { getCurrentUser } from "@/lib/auth";
import { AiSourceNotFoundError } from "@/lib/ai/access/resolveAiReadScope";
import { openAiCitation } from "@/lib/ai/retrieval/citations";

export const runtime = "nodejs";
const respond = (value: unknown, status = 200) => Response.json(value,
  { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ spanId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return respond({ code: "NOT_FOUND" }, 404);
  try { return respond(await openAiCitation(actor.id, (await params).spanId)); }
  catch (error) {
    if (error instanceof AiSourceNotFoundError) return respond({ code: "NOT_FOUND" }, 404);
    throw error;
  }
}
