import { getCurrentUser } from "@/lib/auth";
import { cancelExcelIntakePreviewSession, getExcelIntakePreviewSessionView } from "@/lib/costflow/excelIntakeService";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, sessionId } = await params;
  try {
    const view = await getExcelIntakePreviewSessionView(actor, id, sessionId);
    return Response.json(view, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, sessionId } = await params;
  try {
    const view = await cancelExcelIntakePreviewSession(actor, id, sessionId);
    return Response.json(view, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
