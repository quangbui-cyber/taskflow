import { getCurrentUser } from "@/lib/auth";
import { getReimbursementExport } from "@/lib/costflow/exportData";
import { reimbursementXlsx } from "@/lib/costflow/export";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { id, requestId } = await params;
  const data = await getReimbursementExport(id, requestId, actor);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(reimbursementXlsx(data)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="DNHTU-${requestId}.xlsx"`, "Cache-Control": "private, no-store" } });
}
