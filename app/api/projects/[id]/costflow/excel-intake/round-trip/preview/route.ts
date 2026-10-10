import { getCurrentUser } from "@/lib/auth";
import { previewRoundTripMerge } from "@/lib/costflow/excelRoundTrip";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const form = await request.formData();
    const upload = form.get("file");
    if (!(upload instanceof File) || upload.size === 0) throw new Error("Chọn workbook round-trip cần xem trước.");
    const preview = await previewRoundTripMerge(actor, id, Buffer.from(await upload.arrayBuffer()));
    return Response.json(preview, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "Không đọc được workbook round-trip.";
    const status = /không tìm thấy|không có quyền/i.test(message) ? 404 : 422;
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
