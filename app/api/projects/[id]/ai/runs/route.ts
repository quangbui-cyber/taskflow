import { getCurrentUser } from "@/lib/auth";
import { AiRunDisabledError, AiRunInputError, createAiRun, listAiRuns } from "@/lib/ai/runs/aiRunService";
import { AiSourceNotFoundError } from "@/lib/ai/access/resolveAiReadScope";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: privateHeaders });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return response({ code: "UNAUTHENTICATED" }, 401);
  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); }
  catch { return response({ code: "INVALID_INPUT" }, 422); }
  try {
    return response(await createAiRun(actor.id, id, body), 201);
  } catch (error) {
    if (error instanceof AiRunInputError) return response({ code: error.code }, 422);
    if (error instanceof AiRunDisabledError) return response({ code: error.code }, 503);
    if (error instanceof AiSourceNotFoundError) return response({ code: error.code }, 404);
    throw error;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return response({ code: "UNAUTHENTICATED" }, 401);
  const { id } = await params;
  try { return response({ runs: await listAiRuns(actor.id, id) }); }
  catch (error) {
    if (error instanceof AiSourceNotFoundError) return response({ code: error.code }, 404);
    throw error;
  }
}
