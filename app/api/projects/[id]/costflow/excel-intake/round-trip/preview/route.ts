import { getCurrentUser } from "@/lib/auth";
import { createRoundTripExcelIntakePreview } from "@/lib/costflow/excelIntakeService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const form = await request.formData();
    const upload = form.get("file");
    const draftId = String(form.get("draftId") ?? "").trim();
    if (!(upload instanceof File) || upload.size === 0) throw new Error("Chọn workbook round-trip cần xem trước.");
    if (!draftId) throw new Error("Thiếu nháp round-trip cần xem trước.");
    const preview = await createRoundTripExcelIntakePreview(actor, {
      projectId: id,
      draftId,
      sourceBytes: Buffer.from(await upload.arrayBuffer()),
      sourceFilename: upload.name,
      sourceMimeType: upload.type,
      sourceRevision: Number(form.get("sourceRevision") ?? "1"),
    });
    return Response.json({ previewSessionId: preview.previewSessionId, expiresAt: preview.expiresAt, state: preview.state, operationKind: preview.operationKind, display: preview.display }, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "Không đọc được workbook round-trip.";
    const status = /không tìm thấy|không có quyền/i.test(message) ? 404 : 422;
    const diagnostic = error && typeof error === "object" && "diagnostic" in error ? (error as { diagnostic: unknown }).diagnostic : undefined;
    return Response.json({ error: message, ...(diagnostic ? { diagnostic } : {}) }, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
