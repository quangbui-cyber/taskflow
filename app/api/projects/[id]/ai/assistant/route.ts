import { getCurrentUser } from "@/lib/auth";
import { AiSourceNotFoundError } from "@/lib/ai/access/resolveAiReadScope";
import { answerAuthorizedQuestion } from "@/lib/ai/qa/answer";

export const runtime = "nodejs";
const respond = (value: unknown, status = 200) => Response.json(value,
  { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return respond({ code: "UNAUTHENTICATED" }, 401);
  const { id } = await params;
  let input: unknown;
  try { input = await request.json(); } catch { return respond({ code: "INVALID_INPUT" }, 422); }
  if (!input || typeof input !== "object" || typeof (input as { question?: unknown }).question !== "string")
    return respond({ code: "INVALID_INPUT" }, 422);
  try { return respond(await answerAuthorizedQuestion({ actorId: actor.id,
    context: { kind: "project", projectId: id }, question: (input as { question: string }).question,
    signal: request.signal })); }
  catch (error) {
    if (error instanceof AiSourceNotFoundError) return respond({ code: "NOT_FOUND" }, 404);
    throw error;
  }
}
