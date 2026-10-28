import { getCurrentUser } from "@/lib/auth";
import { AiSourceNotFoundError } from "@/lib/ai/access/resolveAiReadScope";
import { readAiRun } from "@/lib/ai/runs/aiRunService";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401, headers });
  const { id, runId } = await params;
  try { return Response.json(await readAiRun(actor.id, id, runId), { headers }); }
  catch (error) {
    if (error instanceof AiSourceNotFoundError) return Response.json({ code: "NOT_FOUND" }, { status: 404, headers });
    throw error;
  }
}
