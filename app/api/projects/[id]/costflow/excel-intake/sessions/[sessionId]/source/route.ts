import { getCurrentUser } from "@/lib/auth";
import { loadExcelIntakeSourceEvidence } from "@/lib/costflow/excelIntakeService";

export const runtime = "nodejs";

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "confirmed-source.xlsx";
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, sessionId } = await params;
  try {
    const evidence = await loadExcelIntakeSourceEvidence(actor, id, sessionId);
    return new Response(new Uint8Array(evidence.data), {
      headers: {
        "Content-Type": evidence.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Length": String(evidence.size),
        "Content-Disposition": `attachment; filename="${safeFilename(evidence.filename)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Content-SHA256": evidence.sha256,
      },
    });
  } catch {
    return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
