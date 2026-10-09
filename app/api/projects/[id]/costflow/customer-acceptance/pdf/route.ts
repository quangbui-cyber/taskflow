import { getCurrentUser } from "@/lib/auth";
import { customerAcceptancePdf } from "@/lib/costflow/customerAcceptancePdf";
import { getCustomerAcceptanceExport } from "@/lib/costflow/customerAcceptanceProjection";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const snapshotId = new URL(request.url).searchParams.get("snapshotId") ?? "";
  const saved = snapshotId ? await getCustomerAcceptanceExport(id, snapshotId, actor, "PDF") : null;
  if (!saved) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(customerAcceptancePdf(saved.projection)), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="nghiem-thu-khach-hang-v${saved.version}.pdf"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
